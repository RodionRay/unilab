import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>[
  {userId:'owner-1',email:'o1@example.com',name:'O1'},
  {userId:'owner-2',email:'o2@example.com',name:'O2'},
]}));

import {POST} from '@/app/api/cron/tasks-tick/route';
import {verifySessionToken} from '@/lib/auth';
import {listDueTasks,runDueTicks,type DueTask} from '@/lib/processes/tasks-tick-runner';

const SECRET='k'.repeat(40);
const past=()=>new Date(Date.now()-5_000).toISOString();
const future=()=>new Date(Date.now()+60_000).toISOString();
let n=0;

function task(owner:string,kind:string,data:Record<string,unknown>){
  const id=`d0000000-0000-4000-8000-${String(++n).padStart(12,'0')}`;
  testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .run(id,owner,kind,JSON.stringify(data),null,new Date().toISOString());
  return id;
}

function call(auth?:string,url='https://app.test/api/cron/tasks-tick'){
  return POST(new Request(url,{method:'POST',headers:auth?{authorization:auth}:{}}));
}

describe('POST /api/cron/tasks-tick (REQ-I4)',()=>{
  const seen:{action:string;id:string;owner:string;origin:string}[]=[];

  beforeEach(()=>{
    testDb().sqlite.exec('DELETE FROM records;');
    seen.length=0;
    vi.stubEnv('CRON_SECRET',SECRET);
    vi.stubEnv('SESSION_SECRET','s'.repeat(40));
    vi.stubEnv('APP_URL','https://app.test');
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:{body:string;headers:Record<string,string>})=>{
      const body=JSON.parse(init.body) as {action:string;id:string};
      const token=String(init.headers.Cookie).split('=').slice(1).join('=');
      const user=await verifySessionToken(token);
      seen.push({action:body.action,id:body.id,owner:String(user?.userId),origin:new URL(url).origin+'|'+init.headers.Origin});
      return Response.json({ok:true,task:{status:'running'}});
    }));
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects a missing or wrong bearer and a missing secret',async()=>{
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${'x'.repeat(40)}`)).status).toBe(401);
    vi.stubEnv('CRON_SECRET','');
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(seen).toHaveLength(0);
  });

  it('ticks due running/scheduled tasks of every owner, skips waiting/paused/locked ones',async()=>{
    const inv=task('owner-1','invite_task',{status:'running',nextAt:past()});
    const mail=task('owner-1','mailing_task',{status:'scheduled',nextAt:past()});
    const aud=task('owner-1','audience_task',{status:'running'});
    const other=task('owner-2','invite_task',{status:'scheduled',nextAt:''});
    task('owner-1','invite_task',{status:'running',nextAt:future()});
    task('owner-1','mailing_task',{status:'scheduled',nextAt:future()});
    task('owner-1','invite_task',{status:'paused'});
    task('owner-1','audience_task',{status:'completed'});
    task('owner-1','mailing_task',{status:'running',tickLockUntil:future(),tickLockId:'x'});
    task('owner-1','lead',{status:'running'});

    const res=await call(`Bearer ${SECRET}`);
    const body=await res.json() as {due:number;ticked:number;more:boolean};

    expect(res.status).toBe(200);
    expect(body).toMatchObject({due:4,ticked:4,more:false});
    expect(seen.map(s=>`${s.action}:${s.id}:${s.owner}`).sort()).toEqual([
      `tick_audience:${aud}:owner-1`,
      `tick_invite:${inv}:owner-1`,
      `tick_invite:${other}:owner-2`,
      `tick_mailing:${mail}:owner-1`,
    ].sort());
    expect(seen.every(s=>s.origin==='https://app.test|https://app.test')).toBe(true);
  });

  it('calls APP_URL, never the origin from the request Host header',async()=>{
    task('owner-1','invite_task',{status:'running'});
    await call(`Bearer ${SECRET}`,'https://evil.test/api/cron/tasks-tick');
    expect(seen.map(s=>s.origin)).toEqual(['https://app.test|https://app.test']);
  });

  it('without APP_URL calls loopback on the request port',async()=>{
    vi.stubEnv('APP_URL','');
    task('owner-1','invite_task',{status:'running'});
    await call(`Bearer ${SECRET}`,'http://evil.test:5173/api/cron/tasks-tick');
    expect(seen.map(s=>s.origin)).toEqual(['http://127.0.0.1:5173|http://127.0.0.1:5173']);
  });

  it('does not mint a session for an owner that is not an active user',async()=>{
    const ghost=task('ghost-owner','mailing_task',{status:'running'});
    const live=task('owner-1','invite_task',{status:'running'});
    const body=await (await call(`Bearer ${SECRET}`)).json() as {due:number;skipped:number};
    expect(seen.map(s=>s.id)).toEqual([live]);
    expect(seen.map(s=>s.id)).not.toContain(ghost);
    expect(body.skipped).toBe(1);
  });

  it('nothing due → no workspace calls',async()=>{
    task('owner-1','invite_task',{status:'running',nextAt:future()});
    const body=await (await call(`Bearer ${SECRET}`)).json() as {due:number};
    expect(body.due).toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('listDueTasks / runDueTicks',()=>{
  beforeEach(()=>{testDb().sqlite.exec('DELETE FROM records;')});

  it('orders by nextAt, oldest first',async()=>{
    const late=task('o','invite_task',{status:'running',nextAt:new Date(Date.now()-1_000).toISOString()});
    const early=task('o','mailing_task',{status:'running',nextAt:new Date(Date.now()-9_000).toISOString()});
    const due=await listDueTasks(testDb().db);
    expect(due.map(d=>d.id)).toEqual([early,late]);
  });

  it('stops starting ticks when the budget runs out and reports more',async()=>{
    let clock=0;
    const tasks:DueTask[]=[1,2,3,4].map(i=>({owner:'o',id:String(i),kind:'invite_task'}));
    const run=await runDueTicks({
      tasks,
      budgetMs:100,
      callTimeoutMs:50,
      concurrency:1,
      now:()=>clock,
      tick:async(t,timeoutMs)=>{
        expect(timeoutMs).toBe(50);
        clock+=40;
        return {task:t,ok:true,note:''};
      },
    });
    expect(run.outcomes.map(o=>o.task.id)).toEqual(['1','2']);
    expect(run.more).toBe(true);
  });
});
