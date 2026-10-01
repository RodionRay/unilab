import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,cfModule,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const ACC='c7333333-3333-4333-8333-333333333333';
const AUD='c7222222-2222-4222-8222-222222222222';
const INV='c7111111-1111-4111-8111-111111111111';
const MAIL='c7444444-4444-4444-8444-444444444444';

type Row={[key:string]:unknown;log:{text:string}[]};
function row(id:string):Row{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}

/**
 * Runs `concurrent` once, right before the action's first write to the task row — as if a tick
 * committed its progress between the action's read and its write.
 */
function raceFirstTaskWrite(taskId:string,concurrent:()=>void){
  let fired=false;
  const realDb=cfModule.env.DB as {prepare:(q:string)=>{bind:(...v:unknown[])=>Record<string,(...a:unknown[])=>unknown>}};
  cfModule.env.DB={
    prepare(q:string){
      const stmt=realDb.prepare(q);
      return {bind(...values:unknown[]){
        const bound=stmt.bind(...values);
        return {...bound,run:async()=>{
          if(!fired&&/^UPDATE records SET data=\?/.test(q)&&values.includes(taskId)){fired=true;concurrent()}
          return bound.run!();
        }};
      }};
    },
  };
  return ()=>{cfModule.env.DB=realDb};
}

function tickCommits(id:string,patch:Record<string,unknown>){
  return ()=>{
    const cur=row(id);
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?')
      .run(JSON.stringify({...cur,...patch,log:[...cur.log,{at:new Date().toISOString(),level:'ok',text:'тик: прогресс'}]}),id);
  };
}

describe('pause / start / refill merge into the row as it is now (CAS)',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false})));
    addRecord(ACC,'account',{name:'Acc',status:'active'});
    addRecord(AUD,'audience_task',{name:'Src',url:'https://t.me/src',status:'paused',accountIds:[ACC],collected:0,log:[]});
    addRecord(INV,'invite_task',{name:'Inv',targetUrl:'https://t.me/t',audienceTaskId:AUD,accountIds:[ACC],status:'paused',done:0,log:[]});
    addRecord(MAIL,'mailing_task',{
      name:'Mail',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Привет',deliveryMode:'dm',
      accountIds:[ACC],status:'paused',sentTotal:0,deliveredKeys:[],log:[],
    });
  });
  afterEach(()=>{vi.unstubAllGlobals()});

  const cases:[string,string,string,Record<string,unknown>,Record<string,unknown>][]=[
    ['pause_invite',INV,'done',{status:'running'},{status:'paused'}],
    ['start_invite',INV,'done',{status:'paused'},{status:'running'}],
    ['start_invite (already running)',INV,'done',{status:'running'},{status:'running'}],
    ['pause_mailing',MAIL,'sentTotal',{status:'running'},{status:'paused'}],
    ['start_mailing',MAIL,'sentTotal',{status:'paused'},{}],
    ['start_mailing (already running)',MAIL,'sentTotal',{status:'running'},{status:'running'}],
    ['refill_mailing_ai_pool',MAIL,'sentTotal',{},{}],
    ['pause_audience',AUD,'collected',{status:'running'},{status:'paused'}],
    ['start_audience',AUD,'collected',{status:'paused'},{status:'running'}],
  ];

  it.each(cases)('%s keeps tick progress written between its read and its write',async(label,id,field,before,after)=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...row(id),...before}),id);
    const restore=raceFirstTaskWrite(id,tickCommits(id,{[field]:7}));
    try{
      const res=await POST(postRequest({action:label.split(' ')[0],id}));
      expect(res.status).toBe(200);
    }finally{restore()}
    const t=row(id);
    expect(t[field]).toBe(7);
    expect(t.log.map(l=>l.text)).toContain('тик: прогресс');
    expect(t).toMatchObject(after);
  });
});
