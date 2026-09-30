import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {ACC_A,ACC_B,addSealedAccount,dropHarnessAccount,readRecord,writeRecord,type WorkerCall} from './helpers/chats-fixture';
import {moscowDayKey} from '@/lib/telegram-accounts';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const AUD='e1000000-0000-4000-8000-000000000001';
const MAIL='e2000000-0000-4000-8000-000000000002';
const MAIL_LEADS='e3000000-0000-4000-8000-000000000003';
const USERS=['2001','2002','2003'];
const userRow=(uid:string)=>`f000${uid}-0000-4000-8000-000000000000`;

const timeoutError=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
const busy=()=>new Response(JSON.stringify({ok:false,error:'Воркер занят'}),{status:429,headers:{'Content-Type':'application/json'}});
const PEER_MISS='Не удалось открыть пользователя (нет access_hash). Нужен @username или аккаунт фермы из той же группы/сбора.';

type Task=Record<string,unknown>&{log:{text:string}[];aiPool?:string[]};
const task=(id=MAIL)=>readRecord(id) as unknown as Task;
const accountOf=(call:WorkerCall)=>call.body.apiId===1?ACC_A:ACC_B;
const sends=(calls:WorkerCall[])=>calls.filter(c=>c.path==='/send-message');

/** Worker stub: a returned Response (e.g. 429) is passed through as is, a throw rejects fetch. */
function stubWorker(handler:(call:WorkerCall)=>unknown){
  const calls:WorkerCall[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const call={path:new URL(String(url)).pathname,body:init?.body?JSON.parse(String(init.body)):{}};
    if(String(url).startsWith('https://api.telegram.org/'))return Response.json({ok:true});
    calls.push(call);
    const out=await handler(call);
    return out instanceof Response?out:Response.json(out);
  }));
  return {calls};
}

async function tick(id=MAIL){
  const res=await POST(postRequest({action:'tick_mailing',id}));
  return {status:res.status,body:await res.json() as Record<string,unknown>};
}

/** Lets the next tick run right away (the runner would wait for nextAt / deferred recipients). */
function rearm(id=MAIL,extra:Record<string,unknown>={}){
  writeRecord(id,{...task(id),status:'running',nextAt:'',deferredUntil:{},...extra});
}

function seedAudience(users=USERS,extra:(uid:string)=>Record<string,unknown>=()=>({})){
  addRecord(AUD,'audience_task',{name:'Src',url:'https://t.me/src_chat',status:'completed',accountIds:[ACC_A],log:[]});
  for(const uid of users)addRecord(userRow(uid),'audience_user',{taskId:AUD,userId:uid,username:`user${uid}`,...extra(uid)});
}

function seedMailing(extra:Record<string,unknown>={},id=MAIL){
  addRecord(id,'mailing_task',{
    name:'Mail',sourceKind:'audience',audienceTaskId:AUD,contentMode:'template',templateText:'Привет',deliveryMode:'dm',
    accountIds:[ACC_A],batchPerTick:1,dailyLimitEnabled:false,pauseFromSec:45,pauseToSec:45,pauseBetweenAccounts:false,
    status:'running',sentTotal:0,sentToday:0,failed:0,deliveredKeys:[],deferredUntil:{},deliveries:[],log:[],...extra,
  });
}

function registry(){
  const rows=testDb().sqlite.prepare("SELECT data FROM records WHERE owner=? AND kind='mailing_recipient'").all(OWNER) as {data:string}[];
  return rows.map(r=>JSON.parse(r.data) as {key:string;state:string;taskId:string});
}

describe('рассылка · отправка (tick_mailing)',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.spyOn(console,'error').mockImplementation(()=>{});
    dropHarnessAccount();
    await addSealedAccount(ACC_A,{});
    await addSealedAccount(ACC_B,{});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('REQ-M1: PEER_FLOOD от воркера → аккаунт в спамблок, получатель не списан',async()=>{
    seedAudience(['2001']);
    seedMailing();
    stubWorker(()=>({ok:false,status:'spamblock',error:'PEER_FLOOD: Too many requests (caused by SendMessageRequest)'}));

    await tick();

    expect(readRecord(ACC_A)).toMatchObject({status:'spamblock',cooldownReason:'spamblock'});
    expect(task().deliveredKeys).toEqual([]);
    expect(registry()).toEqual([]);
  });

  it('REQ-M2: доставленным не пишем повторно, даже если deliveredKeys обрезан',async()=>{
    seedAudience();
    seedMailing({batchPerTick:3});
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));
    await tick();
    expect(sends(calls)).toHaveLength(3);

    rearm(MAIL,{deliveredKeys:[]});
    await tick();

    expect(sends(calls)).toHaveLength(3);
    expect(task().status).toBe('completed');
    expect(registry().map(r=>r.state).sort()).toEqual(['sent','sent','sent']);
  });

  it('REQ-M3: человеку из рассылки по аудитории рассылка по лидам не пишет второй раз',async()=>{
    seedAudience(['2001']);
    seedMailing();
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));
    await tick();
    expect(sends(calls)).toHaveLength(1);

    seedMailing({sourceKind:'leads',leadFilter:'hot_warm',audienceTaskId:''},MAIL_LEADS);
    const r=await tick(MAIL_LEADS);

    expect(sends(calls)).toHaveLength(1);
    expect(r.body.completed).toBe(true);
  });

  it('REQ-M3: лид, которому уже писала другая рассылка (legacy без реестра), пропускается',async()=>{
    addRecord('e4000000-0000-4000-8000-000000000004','lead',{
      name:'@old',message:'x',source:'Рассылка',status:'working',temperature:'warm',senderId:'3001',mailingTaskId:MAIL,replies:[],
    });
    seedMailing({sourceKind:'leads',leadFilter:'hot_warm',audienceTaskId:''},MAIL_LEADS);
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));

    await tick(MAIL_LEADS);

    expect(sends(calls)).toHaveLength(0);
  });

  it('REQ-M4: FloodWait пишет floodUntil, следующий тик идёт другим аккаунтом',async()=>{
    seedAudience(['2001'],()=>({collectedByAccountId:ACC_A}));
    seedMailing({accountIds:[ACC_A,ACC_B]});
    const {calls}=stubWorker(call=>accountOf(call)===ACC_A
      ?{ok:false,status:'flood',error:'FloodWait 600с',waitSec:600}
      :{ok:true,messageId:'7'});

    await tick();
    const floodUntil=Date.parse(String(readRecord(ACC_A).floodUntil));
    expect(floodUntil-Date.now()).toBeGreaterThan(590_000);
    expect(readRecord(ACC_A).status).toBe('active');

    rearm();
    await tick();

    expect(sends(calls).map(accountOf)).toEqual([ACC_A,ACC_B]);
    expect(task().sentTotal).toBe(1);
  });

  it('REQ-M5: «нет access_hash» — следующая попытка другим аккаунтом, потом окончательный отказ и задача завершается',async()=>{
    seedAudience(['2001'],()=>({collectedByAccountId:ACC_A}));
    seedMailing({accountIds:[ACC_A,ACC_B]});
    const {calls}=stubWorker(()=>({ok:false,error:PEER_MISS}));

    await tick();
    rearm();
    await tick();
    rearm();
    const r=await tick();

    expect(sends(calls).map(accountOf)).toEqual([ACC_A,ACC_B]);
    expect(r.body.completed).toBe(true);
    expect(task().failed).toBe(2);
  });

  it('REQ-M6: успех засчитывается тому аккаунту, который отправил',async()=>{
    seedAudience(['2001','2002'],uid=>({collectedByAccountId:uid==='2001'?ACC_A:ACC_B}));
    seedMailing({accountIds:[ACC_A,ACC_B],batchPerTick:2});
    stubWorker(()=>({ok:true,messageId:'1'}));

    await tick();

    expect(readRecord(ACC_A).messagesToday).toBe(1);
    expect(readRecord(ACC_B).messagesToday).toBe(1);
  });

  it('REQ-M6: квота аккаунта проверяется перед каждой отправкой',async()=>{
    const day=moscowDayKey();
    writeRecord(ACC_A,{...readRecord(ACC_A),limits:{invite:40,message:1,chat:10},messagesToday:0,messagesDay:day});
    writeRecord(ACC_B,{...readRecord(ACC_B),limits:{invite:40,message:1,chat:10},messagesToday:0,messagesDay:day});
    seedAudience(USERS,()=>({collectedByAccountId:ACC_A}));
    seedMailing({accountIds:[ACC_A,ACC_B],batchPerTick:3});
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));

    await tick();

    expect(sends(calls).map(accountOf).sort()).toEqual([ACC_A,ACC_B]);
    expect(readRecord(ACC_A).messagesToday).toBe(1);
    expect(readRecord(ACC_B).messagesToday).toBe(1);
  });

  it('REQ-M6: дневной лимит задачи режет батч',async()=>{
    seedAudience();
    seedMailing({batchPerTick:3,dailyLimitEnabled:true,dailyLimit:2,sentToday:1,sendDay:moscowDayKey()});
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));

    await tick();

    expect(sends(calls)).toHaveLength(1);
    expect(task().sentToday).toBe(2);
  });

  it('REQ-M7: DM не уводит в отлёжку из-за исчерпанных вступлений',async()=>{
    const day=moscowDayKey();
    writeRecord(ACC_A,{...readRecord(ACC_A),limits:{invite:2,message:10,chat:10},joinsToday:2,joinsDay:day});
    seedAudience(['2001']);
    seedMailing();
    stubWorker(()=>({ok:true,messageId:'1'}));

    await tick();

    expect(readRecord(ACC_A)).toMatchObject({status:'active',messagesToday:1});
  });

  it('R1: таймаут отправки → получатель «unknown», повторно не пишем',async()=>{
    seedAudience(['2001']);
    seedMailing();
    let n=0;
    const {calls}=stubWorker(()=>{n++;if(n===1)throw timeoutError();return {ok:true,messageId:'1'}});

    const first=await tick();
    expect(first.body.retry).toBe(true);
    expect(registry()).toMatchObject([{key:'dm:u:2001',state:'unknown',taskId:MAIL}]);
    expect(task().deliveries).toMatchObject([{key:'u:2001',ok:false}]);

    rearm();
    await tick();

    expect(sends(calls)).toHaveLength(1);
  });

  it('R1: воркер занят (429) → не отправлено, получатель снова в очереди',async()=>{
    seedAudience(['2001']);
    seedMailing();
    let n=0;
    const {calls}=stubWorker(()=>{n++;return n===1?busy():{ok:true,messageId:'1'}});

    await tick();
    expect(registry()).toEqual([]);
    rearm();
    await tick();

    expect(sends(calls)).toHaveLength(2);
    expect(registry()).toMatchObject([{key:'dm:u:2001',state:'sent'}]);
  });

  it('R1: «pending» упавшего тика через 15+ мин → «unknown» в журнале и доставках, без повторной отправки',async()=>{
    seedAudience(['2001','2002']);
    seedMailing({batchPerTick:2});
    const claim=(uid:string,ageMs:number)=>testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,NULL,?)').run(
      `mr:${OWNER}:dm:u:${uid}`,OWNER,'mailing_recipient',
      JSON.stringify({key:`dm:u:${uid}`,state:'pending',taskId:MAIL,accountId:ACC_A,leadId:'',at:new Date(Date.now()-ageMs).toISOString(),error:''}),
      new Date().toISOString(),
    );
    claim('2001',60*60_000);
    claim('2002',60_000);
    const {calls}=stubWorker(()=>({ok:true,messageId:'1'}));

    await tick();

    expect(sends(calls)).toHaveLength(0);
    const byKey=Object.fromEntries(registry().map(r=>[r.key,r.state]));
    expect(byKey).toEqual({'dm:u:2001':'unknown','dm:u:2002':'pending'});
    expect(task().deliveries).toMatchObject([{key:'u:2001',userId:'2001',ok:false}]);
    expect(task().log.map(l=>l.text).join('\n')).toMatch(/id2001.*могло уйти/);
  });

  it('R2: AI-текст возвращается в пул, если отправка упала',async()=>{
    seedAudience(['2001']);
    const pool=['t1','t2','t3','t4','t5','t6'];
    seedMailing({contentMode:'ai',aiPool:pool,aiPoolUsed:0});
    stubWorker(()=>busy());

    await tick();

    expect(task().aiPool).toEqual(pool);
    expect(task().aiPoolUsed).toBe(0);
  });
});
