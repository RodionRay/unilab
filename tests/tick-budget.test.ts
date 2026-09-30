import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {TICK_LOCK_TTL_MS} from '@/lib/processes/tick-lock';
import {TICK_WALL_BUDGET_MS,TICK_WORST_CASE_MS} from '@/lib/processes/tick-budget';
import {TASKS_TICK_CALL_TIMEOUT_MS,TASKS_TICK_RUN_BUDGET_MS,runDueTicks,type DueTask} from '@/lib/processes/tasks-tick-runner';
import {WORKER_LONGEST_APP_TIMEOUT_MS} from '@/lib/worker-timeouts';
import {TASKS_TICK_FETCH_MS} from '../telegram-worker/src/worker-app.mjs';

const ACC='a3333333-3333-4333-8333-333333333333';
const ACC2='a3333333-3333-4333-8333-333333333334';
const ACC3='a3333333-3333-4333-8333-333333333335';
const AUD='a2222222-2222-4222-8222-222222222222';
const INV='a1111111-1111-4111-8111-111111111111';
const MAIL='a4444444-4444-4444-8444-444444444444';

type Row={[key:string]:unknown;status?:string;nextAt:string;tickLockUntil?:string;log:{text:string}[]};
function row(id:string):Row{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}

/** Worker stub where every call "takes" `costMs` of the fake wall clock. */
let clock=0;
const calls:string[]=[];
function slowWorker(costMs:(path:string)=>number,handler:(path:string)=>unknown){
  calls.length=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const path=new URL(String(url)).pathname;
    calls.push(path);
    clock+=costMs(path);
    return Response.json(handler(path));
  }));
}

async function tick(action:string,id:string){
  const res=await POST(postRequest({action,id}));
  return {status:res.status,body:await res.json() as Record<string,unknown>};
}

async function account(id:string){
  addRecord(id,'account',{name:id.slice(-1),phone:'+7999000000'+id.slice(-1),status:'active'},await seal(JSON.stringify({kind:'tdata',zipBase64:'eA=='}),OWNER));
}

describe('tick wall budget: every caller waits longer than the worst tick',()=>{
  it('one longest worker call fits into the tick budget',()=>{
    expect(TICK_WALL_BUDGET_MS).toBeGreaterThanOrEqual(WORKER_LONGEST_APP_TIMEOUT_MS);
  });

  it('runner call timeout, lock TTL, run budget and the worker fetch are ordered',()=>{
    expect(TASKS_TICK_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(TICK_WORST_CASE_MS);
    expect(TICK_LOCK_TTL_MS).toBeGreaterThanOrEqual(TICK_WORST_CASE_MS);
    expect(TASKS_TICK_RUN_BUDGET_MS).toBeGreaterThanOrEqual(TASKS_TICK_CALL_TIMEOUT_MS);
    expect(TASKS_TICK_FETCH_MS).toBeGreaterThan(TASKS_TICK_RUN_BUDGET_MS);
  });

  it('runDueTicks never cuts a tick call below callTimeoutMs',async()=>{
    let now=0;
    const tasks:DueTask[]=[1,2,3].map(i=>({owner:'o',id:String(i),kind:'invite_task'}));
    const timeouts:number[]=[];
    const run=await runDueTicks({
      tasks,budgetMs:100,callTimeoutMs:60,concurrency:1,now:()=>now,
      tick:async(t,timeoutMs)=>{timeouts.push(timeoutMs);now+=30;return {task:t,ok:true,note:''}},
    });
    expect(timeouts).toEqual([60,60]);
    expect(run.more).toBe(true);
  });
});

describe('ticks stop starting worker calls that would outlive the budget',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    clock=Date.now();
    vi.spyOn(Date,'now').mockImplementation(()=>clock);
    await account(ACC);
    addRecord(AUD,'audience_task',{name:'Src',url:'https://t.me/src_chat',status:'completed',accountIds:[ACC],collected:3,hasMore:false,log:[]});
    for(const n of [1,2,3,4,5])addRecord(`b000000${n}-0000-4000-8000-000000000000`,'audience_user',{taskId:AUD,userId:`200${n}`,username:`user${n}`,invited:false});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('mailing: sends while a send fits, commits the rest for the next tick',async()=>{
    addRecord(MAIL,'mailing_task',{
      name:'Mail',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Привет',deliveryMode:'dm',
      accountIds:[ACC],batchPerTick:10,dailyLimitEnabled:false,pauseFromSec:45,pauseToSec:45,pauseBetweenAccounts:false,
      status:'running',sentTotal:0,sentToday:0,failed:0,deliveredKeys:[],deferredUntil:{},deliveries:[],log:[],
    });
    slowWorker(()=>100_000,()=>({ok:true,messageId:'1'}));

    const r=await tick('tick_mailing',MAIL);

    expect(calls.filter(p=>p==='/send-message')).toHaveLength(2);
    const t=row(MAIL);
    expect(r.body.ok).toBe(true);
    expect(t).toMatchObject({status:'running',sentTotal:2,tickLockUntil:''});
    expect(t.log.map(l=>l.text).join('\n')).toMatch(/Лимит времени тика/);
  });

  it('invite: does not start /invite-users when it would outlive the budget; continues soon',async()=>{
    addRecord(INV,'invite_task',{
      name:'Inv',targetUrl:'https://t.me/target_chat',audienceTaskId:AUD,accountIds:[ACC],batchSize:3,
      status:'running',done:0,invitedToday:0,pauseFromSec:15,pauseToSec:15,stopDisconnectedPct:30,log:[],
    });
    slowWorker(p=>p==='/join-group'?70_000:0,p=>p==='/join-group'?{ok:true,join:'already'}:{ok:true,results:[]});

    await tick('tick_invite',INV);

    expect(calls).not.toContain('/invite-users');
    const t=row(INV);
    expect(t).toMatchObject({status:'running',tickLockUntil:''});
    const wait=Date.parse(t.nextAt)-clock;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10_000);
  });

  it('audience: tries slots only while a collect call fits, rotates past the tried ones',async()=>{
    await account(ACC2);
    await account(ACC3);
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({
      ...row(AUD),accountIds:[ACC,ACC2,ACC3],status:'running',hasMore:true,collected:0,cursor:'',accountRotateAt:0,
    }),AUD);
    slowWorker(()=>100_000,()=>({ok:false,error:'Слот не видит источник',usernameMissing:true}));

    await tick('tick_audience',AUD);

    expect(calls.filter(p=>p==='/collect-audience')).toHaveLength(1);
    const t=row(AUD);
    expect(t).toMatchObject({status:'running',accountRotateAt:1,tickLockUntil:''});
  });
});
