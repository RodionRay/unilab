import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const ACC='a3333333-3333-4333-8333-333333333333';
const AUD='a2222222-2222-4222-8222-222222222222';
const INV='a1111111-1111-4111-8111-111111111111';
const MAIL='a4444444-4444-4444-8444-444444444444';
const LIVE_LOCK=()=>new Date(Date.now()+100_000).toISOString();

type WorkerHandler=(path:string,body:Record<string,unknown>)=>Promise<unknown>|unknown;
const calls:string[]=[];

function stubWorker(handler:WorkerHandler){
  calls.length=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:{body:string})=>{
    const path=new URL(String(url)).pathname;
    calls.push(path);
    const out=await handler(path,JSON.parse(init.body));
    return out instanceof Response?out:Response.json(out);
  }));
}

type Row={[key:string]:unknown;status?:string;nextAt:string;tickLockUntil?:string;log:{text:string}[]};
function row(id:string):Row{
  const r=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(r.data);
}

function busy(){return Response.json({ok:false,error:'Воркер занят, повторите позже'},{status:429})}
function timeout(){return Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'})}

async function tick(action:string,id:string){
  const res=await POST(postRequest({action,id}));
  return {status:res.status,body:await res.json() as Record<string,unknown>};
}

function expectRetryWindow(nextAt:string){
  const wait=Date.parse(nextAt)-Date.now();
  expect(wait).toBeGreaterThanOrEqual(25_000);
  expect(wait).toBeLessThanOrEqual(61_000);
}

async function seedFarm(){
  addRecord(ACC,'account',{name:'Acc',phone:'+79990000001',status:'active'},await seal(JSON.stringify({kind:'tdata',zipBase64:'eA=='}),OWNER));
  addRecord(AUD,'audience_task',{
    name:'Src',url:'https://t.me/src_chat',status:'completed',accountIds:[ACC],collected:3,hasMore:false,
    collectMode:'discussions',rangeMode:'count',messageLimit:5000,cursor:'',log:[],
  });
  for(const n of [1,2,3]){
    addRecord(`b000000${n}-0000-4000-8000-000000000000`,'audience_user',{taskId:AUD,userId:`200${n}`,username:`user${n}`,invited:false});
  }
}

function seedInvite(extra:Record<string,unknown>={}){
  addRecord(INV,'invite_task',{
    name:'Inv',targetUrl:'https://t.me/target_chat',audienceTaskId:AUD,accountIds:[ACC],batchSize:1,
    status:'running',done:0,invitedToday:0,pauseFromSec:15,pauseToSec:15,stopDisconnectedPct:30,log:[],...extra,
  });
}

function seedMailing(extra:Record<string,unknown>={}){
  addRecord(MAIL,'mailing_task',{
    name:'Mail',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Привет',deliveryMode:'dm',
    accountIds:[ACC],batchPerTick:3,dailyLimitEnabled:false,pauseFromSec:45,pauseToSec:45,pauseBetweenAccounts:false,
    status:'running',sentTotal:0,sentToday:0,failed:0,deliveredKeys:[],deferredUntil:{},deliveries:[],log:[],...extra,
  });
}

function seedAudienceRunning(extra:Record<string,unknown>={}){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({
    ...row(AUD),status:'running',hasMore:true,collected:0,cursor:'',...extra,
  }),AUD);
}

const inviteOk=(path:string)=>{
  if(path==='/join-group')return {ok:true,join:'already'};
  if(path==='/invite-users')return {ok:true,results:[{userId:'2001',username:'user1',ok:true}]};
  return {ok:false,error:`unexpected ${path}`};
};

describe('tick runtime (invite / mailing / audience)',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    await seedFarm();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('REQ-I1 atomic tick lock',()=>{
    it('two concurrent tick_invite of one task run the worker exactly once',async()=>{
      seedInvite();
      let open:()=>void=()=>{};
      const gate=new Promise<void>(r=>{open=r});
      stubWorker(async path=>{
        if(path==='/invite-users')await gate;
        return inviteOk(path);
      });

      const first=tick('tick_invite',INV);
      const second=tick('tick_invite',INV);
      await vi.waitFor(()=>expect(calls).toContain('/invite-users'));
      await new Promise(r=>setTimeout(r,30));
      open();
      const results=await Promise.all([first,second]);

      expect(calls.filter(p=>p==='/invite-users')).toHaveLength(1);
      expect(results.filter(r=>r.body.busy)).toHaveLength(1);
      expect(row(INV).done).toBe(1);
    });

    it('two concurrent tick_mailing of one task send each message once',async()=>{
      seedMailing({batchPerTick:1});
      let open:()=>void=()=>{};
      const gate=new Promise<void>(r=>{open=r});
      stubWorker(async path=>{
        if(path==='/send-message'){await gate;return {ok:true,messageId:'1'}}
        return {ok:false};
      });

      const both=Promise.all([tick('tick_mailing',MAIL),tick('tick_mailing',MAIL)]);
      await vi.waitFor(()=>expect(calls).toContain('/send-message'));
      await new Promise(r=>setTimeout(r,30));
      open();
      await both;

      expect(calls.filter(p=>p==='/send-message')).toHaveLength(1);
      expect(row(MAIL).sentTotal).toBe(1);
    });

    it('pause and start keep a live tick lock',async()=>{
      const until=LIVE_LOCK();
      seedInvite({tickLockUntil:until,tickLockId:'other-tick'});
      stubWorker(inviteOk);

      await POST(postRequest({action:'pause_invite',id:INV}));
      expect(row(INV)).toMatchObject({status:'paused',tickLockUntil:until});

      await POST(postRequest({action:'start_invite',id:INV}));
      expect(row(INV)).toMatchObject({status:'running',tickLockUntil:until});

      const r=await tick('tick_invite',INV);
      expect(r.body.busy).toBe(true);
      expect(calls).not.toContain('/invite-users');
    });

    it('pause_mailing and start_audience keep a live tick lock',async()=>{
      const until=LIVE_LOCK();
      seedMailing({tickLockUntil:until,tickLockId:'other'});
      seedAudienceRunning({status:'paused',tickLockUntil:until,tickLockId:'other'});
      stubWorker(()=>({ok:false}));

      await POST(postRequest({action:'pause_mailing',id:MAIL}));
      await POST(postRequest({action:'start_audience',id:AUD}));

      expect(row(MAIL).tickLockUntil).toBe(until);
      expect(row(AUD)).toMatchObject({status:'running',tickLockUntil:until});
    });

    it('an expired lock is taken over',async()=>{
      seedInvite({tickLockUntil:new Date(Date.now()-1_000).toISOString(),tickLockId:'dead'});
      stubWorker(inviteOk);

      await tick('tick_invite',INV);

      expect(calls).toContain('/invite-users');
      expect(row(INV)).toMatchObject({done:1,tickLockUntil:''});
    });
  });

  describe('REQ-I2 worker busy / own timeout → retry, not error',()=>{
    it('mailing: 429 mid-batch keeps running, retries in 30–60 s, keeps the delivered part',async()=>{
      seedMailing();
      let sends=0;
      stubWorker(path=>{
        if(path!=='/send-message')return {ok:false};
        sends++;
        return sends===1?{ok:true,messageId:'11'}:busy();
      });

      const r=await tick('tick_mailing',MAIL);

      expect(r.status).toBe(200);
      const t=row(MAIL);
      expect(t.status).toBe('running');
      expect(t.error).toBe('');
      expect(t.tickLockUntil).toBe('');
      expectRetryWindow(t.nextAt);
      expect(t.sentTotal).toBe(1);
      expect(t.deliveredKeys).toEqual(['u:2001']);
      expect(t.deliveries).toHaveLength(1);
      expect(row(ACC).messagesToday).toBe(1);
    });

    it('mailing: our own abort timeout is a retry too',async()=>{
      seedMailing({batchPerTick:1});
      stubWorker(()=>{throw timeout()});

      await tick('tick_mailing',MAIL);

      const t=row(MAIL);
      expect(t.status).toBe('running');
      expectRetryWindow(t.nextAt);
    });

    it('invite: timeout on /invite-users keeps running with nextAt in 30–60 s',async()=>{
      seedInvite();
      stubWorker(path=>{
        if(path==='/invite-users')throw timeout();
        return inviteOk(path);
      });

      const r=await tick('tick_invite',INV);

      expect(r.status).toBe(200);
      const t=row(INV);
      expect(t).toMatchObject({status:'running',error:'',tickLockUntil:''});
      expectRetryWindow(t.nextAt);
    });

    it('invite: 429 on /join-group keeps running',async()=>{
      seedInvite();
      stubWorker(()=>busy());

      await tick('tick_invite',INV);

      const t=row(INV);
      expect(t.status).toBe('running');
      expectRetryWindow(t.nextAt);
    });

    it('audience: 429 on /collect-audience keeps running, account untouched',async()=>{
      seedAudienceRunning();
      stubWorker(()=>busy());

      await tick('tick_audience',AUD);

      const t=row(AUD);
      expect(t).toMatchObject({status:'running',tickLockUntil:''});
      expectRetryWindow(t.nextAt);
      expect(row(ACC).status).toBe('active');
    });

    it('audience: our own timeout is not a proxy fault',async()=>{
      seedAudienceRunning();
      stubWorker(()=>{throw timeout()});

      await tick('tick_audience',AUD);

      expect(row(AUD).status).toBe('running');
      expect(row(ACC).status).toBe('active');
    });

    it('audience: a task waiting for nextAt is not ticked',async()=>{
      seedAudienceRunning({nextAt:new Date(Date.now()+40_000).toISOString()});
      stubWorker(()=>({ok:true,users:[],hasMore:true}));

      const r=await tick('tick_audience',AUD);

      expect(r.body.waiting).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  describe('REQ-I3 pause during an in-flight tick',()=>{
    it('invite: stays paused and keeps the tick progress',async()=>{
      seedInvite();
      stubWorker(async path=>{
        if(path==='/invite-users')await POST(postRequest({action:'pause_invite',id:INV}));
        return inviteOk(path);
      });

      await tick('tick_invite',INV);

      const t=row(INV);
      expect(t.status).toBe('paused');
      expect(t.done).toBe(1);
      expect(t.invitedToday).toBe(1);
      expect(t.tickLockUntil).toBe('');
      const texts=(t.log as {text:string}[]).map(e=>e.text);
      expect(texts).toContain('Задача остановлена');
      expect(texts.some(x=>/user1/.test(x))).toBe(true);
    });

    it('mailing: stays paused and keeps delivered keys, counters, deliveries',async()=>{
      seedMailing({batchPerTick:1});
      stubWorker(async path=>{
        if(path==='/send-message')await POST(postRequest({action:'pause_mailing',id:MAIL}));
        return {ok:true,messageId:'5'};
      });

      await tick('tick_mailing',MAIL);

      const t=row(MAIL);
      expect(t.status).toBe('paused');
      expect(t.deliveredKeys).toEqual(['u:2001']);
      expect(t.sentTotal).toBe(1);
      expect(t.deliveries).toHaveLength(1);
      expect(t.nextAt).toBe('');
      expect(t.tickLockUntil).toBe('');
    });

    it('audience: stays paused and keeps the collected batch',async()=>{
      seedAudienceRunning();
      stubWorker(async path=>{
        if(path==='/collect-audience')await POST(postRequest({action:'pause_audience',id:AUD}));
        return {ok:true,users:[{userId:'3001',username:'fresh'}],hasMore:true,cursor:'c1'};
      });

      await tick('tick_audience',AUD);

      const t=row(AUD);
      expect(t.status).toBe('paused');
      expect(t.collected).toBe(1);
      expect(t.cursor).toBe('c1');
      expect(t.tickLockUntil).toBe('');
    });
  });

  describe('REQ-I5 save keeps server-side progress',()=>{
    const saveBody=(kind:string,id:string,data:Record<string,unknown>)=>postRequest({action:'save',kind,id,data});

    it('invite: config from the form, progress/status/lock from the server',async()=>{
      const until=LIVE_LOCK();
      seedInvite({done:7,invitedToday:3,inviteDay:'2026-09-30',accountIndex:2,tickLockUntil:until,tickLockId:'t1',nextAt:'2026-09-30T10:00:00.000Z'});
      stubWorker(()=>({ok:false}));

      const res=await POST(saveBody('invite_task',INV,{
        name:'Inv 2',targetUrl:'https://t.me/target_chat',audienceTaskId:AUD,accountIds:[ACC],batchSize:5,
        status:'draft',done:0,invitedToday:0,accountIndex:0,nextAt:'',
      }));

      expect(res.status).toBe(200);
      expect(row(INV)).toMatchObject({
        name:'Inv 2',batchSize:5,status:'running',done:7,invitedToday:3,inviteDay:'2026-09-30',accountIndex:2,
        tickLockUntil:until,tickLockId:'t1',nextAt:'2026-09-30T10:00:00.000Z',
      });
    });

    it('mailing: delivered keys and counters survive a stale form',async()=>{
      seedMailing({sentTotal:4,sentToday:4,failed:1,deliveredKeys:['u:2001'],status:'scheduled',lastAccountId:ACC});
      stubWorker(()=>({ok:false}));

      await POST(saveBody('mailing_task',MAIL,{
        name:'Mail 2',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Новый текст',
        deliveryMode:'dm',accountIds:[ACC],sentTotal:0,failed:0,deliveredKeys:[],status:'paused',
      }));

      expect(row(MAIL)).toMatchObject({
        name:'Mail 2',templateText:'Новый текст',sentTotal:4,sentToday:4,failed:1,deliveredKeys:['u:2001'],
        status:'scheduled',lastAccountId:ACC,
      });
    });

    it('audience: same source keeps the cursor, a new url resets it',async()=>{
      seedAudienceRunning({cursor:'c9',collected:40,hasMore:true,emptyStreak:2});
      stubWorker(()=>({ok:false}));
      const base={name:'Src',accountIds:[ACC],collectMode:'discussions',cursor:'',collected:0};

      await POST(saveBody('audience_task',AUD,{...base,url:'https://t.me/src_chat',messageLimit:900}));
      expect(row(AUD)).toMatchObject({cursor:'c9',collected:40,messageLimit:900,status:'running',emptyStreak:2});

      await POST(saveBody('audience_task',AUD,{...base,url:'https://t.me/other_chat'}));
      expect(row(AUD)).toMatchObject({cursor:'',collected:0,hasMore:true,url:'https://t.me/other_chat'});
    });

    it('audience: switching collectMode resets the cursor',async()=>{
      seedAudienceRunning({cursor:'c9',collected:40,hasMore:false});
      stubWorker(()=>({ok:false}));

      await POST(saveBody('audience_task',AUD,{name:'Src',url:'https://t.me/src_chat',accountIds:[ACC],collectMode:'comments'}));

      expect(row(AUD)).toMatchObject({cursor:'',collected:0,hasMore:true,collectMode:'comments'});
    });
  });

  describe('REQ-I6 app-side worker timeouts cover the worker job + queue',()=>{
    async function timeoutsFor(run:()=>Promise<unknown>){
      const spy=vi.spyOn(AbortSignal,'timeout');
      const seen:Record<string,number>={};
      vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
        const path=new URL(String(url)).pathname;
        seen[path]=Number(spy.mock.calls.at(-1)?.[0]);
        if(path==='/collect-audience')return Response.json({ok:true,users:[],hasMore:true,cursor:'x'});
        if(path==='/invite-users')return Response.json({ok:true,results:[]});
        if(path==='/send-message')return Response.json({ok:true,messageId:'1'});
        return Response.json({ok:true,join:'already'});
      }));
      await run();
      return seen;
    }

    it('collect / invite / join / send wait at least job timeout + queue margin',async()=>{
      const {timeoutForAction}=await import('../telegram-worker/src/worker-app.mjs');
      const {WORKER_QUEUE_MARGIN_MS}=await import('@/lib/worker-timeouts');
      seedAudienceRunning();
      seedInvite();
      seedMailing({batchPerTick:1});

      const seen={
        ...await timeoutsFor(()=>tick('tick_audience',AUD)),
        ...await timeoutsFor(()=>tick('tick_invite',INV)),
        ...await timeoutsFor(()=>tick('tick_mailing',MAIL)),
      };

      expect(WORKER_QUEUE_MARGIN_MS).toBeGreaterThanOrEqual(30_000);
      expect(seen['/collect-audience']).toBeGreaterThanOrEqual(timeoutForAction('collect')+WORKER_QUEUE_MARGIN_MS);
      expect(seen['/invite-users']).toBeGreaterThanOrEqual(timeoutForAction('invite')+WORKER_QUEUE_MARGIN_MS);
      expect(seen['/join-group']).toBeGreaterThanOrEqual(timeoutForAction('join')+WORKER_QUEUE_MARGIN_MS);
      expect(seen['/send-message']).toBeGreaterThanOrEqual(timeoutForAction('send')+WORKER_QUEUE_MARGIN_MS);
    });
  });
});
