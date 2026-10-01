import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const ID_A='66666666-6666-4666-8666-666666666666';
const ID_B='77777777-7777-4777-8777-777777777777';
const ID_MISSING='88888888-8888-4888-8888-888888888888';
const PAUSE_MS=1500;
const LEAKY=/10\.0\.0\.5|stack|ECONNREFUSED/;

type Result={id:string;ok:boolean;error:string};
type Bulk={ok:boolean;updated:number;failed:number;results:Result[]};
type Call={at:number;body:Record<string,unknown>};

function stubWorker(answer:(body:Record<string,unknown>)=>Record<string,unknown>|Error){
  const calls:Call[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body)) as Record<string,unknown>;
    calls.push({at:Date.now(),body});
    const a=answer(body);
    if(a instanceof Error)throw a;
    return Response.json(a);
  }));
  return calls;
}

function accountData(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}

async function addLiveAccount(id:string,zip:string,extra:Record<string,unknown>={}){
  const secret=await seal(JSON.stringify({kind:'session',zipBase64:zip,apiId:1,apiHash:'h'}),OWNER);
  addRecord(id,'account',{name:`Live ${zip}`,phone:'+79990002233',status:'active',proxyId:'',joinsToday:3,...extra},secret);
}

/** Runs the request under fake setTimeout, advancing time until it settles; counts the inter-account pauses. */
async function bulk(payload:Record<string,unknown>):Promise<{status:number;body:Bulk;pauses:number}>{
  const timer=vi.spyOn(globalThis,'setTimeout');
  let settled=false;
  const pending=POST(postRequest({action:'bulk_apply_account_last_seen',...payload})).finally(()=>{settled=true});
  while(!settled){
    await new Promise(r=>setImmediate(r));
    if(!settled)await vi.advanceTimersByTimeAsync(100);
  }
  const res=await pending;
  const pauses=timer.mock.calls.filter(c=>c[1]===PAUSE_MS).length;
  timer.mockRestore();
  return {status:res.status,body:await res.json() as Bulk,pauses};
}

describe('bulk_apply_account_last_seen: массово скрыть/показать «был в сети»',()=>{
  beforeEach(()=>{
    vi.useFakeTimers({toFake:['setTimeout','Date']});
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
  });
  afterEach(()=>{
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('два живых аккаунта: воркер вызван для каждой сессии, пауза между ними, состояние записано у каждого',async()=>{
    await addLiveAccount(ID_A,'QUFB');
    await addLiveAccount(ID_B,'QkJC');
    const calls=stubWorker(()=>({ok:true,hidden:true}));

    const {status,body,pauses}=await bulk({ids:[ID_A,ID_B,ID_A],hide:true});

    expect(status).toBe(200);
    expect(body).toEqual({ok:true,updated:2,failed:0,results:[{id:ID_A,ok:true,error:''},{id:ID_B,ok:true,error:''}]});
    expect(calls.map(c=>c.body.zipBase64)).toEqual(['QUFB','QkJC']);
    expect(calls.every(c=>c.body.hideLastSeen===true)).toBe(true);
    expect(calls[1].at-calls[0].at).toBeGreaterThanOrEqual(PAUSE_MS);
    expect(pauses).toBe(1);
    for(const id of [ID_A,ID_B]){
      const data=accountData(id);
      expect(data.hideLastSeen).toBe(true);
      expect(data.lastSeenPrivacy).toMatchObject({hidden:true,applied:true,error:''});
      expect(data.lastSeenPrivacyLease).toBeUndefined();
      expect(data.joinsToday).toBe(3);
    }
  });

  it('смешанный список: без сессии, несуществующий и живой → счётчики и причины, пауз без вызова воркера нет',async()=>{
    addRecord(ID_B,'account',{name:'NoSess',phone:'+79990002233',status:'setup',proxyId:''},null);
    await addLiveAccount(ID_A,'QUFB');
    const calls=stubWorker(()=>({ok:true,hidden:true}));

    const {body,pauses}=await bulk({ids:[ID_B,ID_MISSING,ID_A],hide:true});

    expect(body).toMatchObject({ok:true,updated:1,failed:2});
    expect(body.results).toEqual([
      {id:ID_B,ok:false,error:'Нет сессии'},
      {id:ID_MISSING,ok:false,error:'Не найден'},
      {id:ID_A,ok:true,error:''},
    ]);
    expect(calls).toHaveLength(1);
    expect(pauses).toBe(0);
    expect(accountData(ID_B).lastSeenPrivacy).toMatchObject({hidden:true,applied:false,error:'Нет сессии'});
  });

  it('аккаунт под арендой → «уже применяется», воркер для него не зовётся, остальные идут',async()=>{
    await addLiveAccount(ID_A,'QUFB',{lastSeenPrivacyLease:new Date(Date.now()+30_000).toISOString()});
    await addLiveAccount(ID_B,'QkJC');
    const calls=stubWorker(()=>({ok:true,hidden:true}));

    const {body}=await bulk({ids:[ID_A,ID_B],hide:true});

    expect(body).toMatchObject({updated:1,failed:1});
    expect(body.results[0]).toEqual({id:ID_A,ok:false,error:'«Был в сети» уже применяется — подождите минуту'});
    expect(body.results[1]).toEqual({id:ID_B,ok:true,error:''});
    expect(calls.map(c=>c.body.zipBase64)).toEqual(['QkJC']);
    expect(accountData(ID_A).hideLastSeen).toBeUndefined();
  });

  it('заморозка от воркера помечает аккаунт frozen и считается ошибкой',async()=>{
    await addLiveAccount(ID_A,'QUFB');
    await addLiveAccount(ID_B,'QkJC');
    stubWorker(body=>body.zipBase64==='QUFB'?{ok:false,status:'frozen',error:'Telegram ограничил смену приватности (заморозка)'}:{ok:true,hidden:true});

    const {body}=await bulk({ids:[ID_A,ID_B],hide:true});

    expect(body).toMatchObject({updated:1,failed:1});
    expect(body.results[0]).toEqual({id:ID_A,ok:false,error:'Telegram ограничил смену приватности (заморозка)'});
    expect(accountData(ID_A).status).toBe('frozen');
    expect(accountData(ID_B).status).toBe('active');
  });

  it('hide:false показывает «был в сети» у всех',async()=>{
    await addLiveAccount(ID_A,'QUFB',{hideLastSeen:true});
    await addLiveAccount(ID_B,'QkJC',{hideLastSeen:true});
    const calls=stubWorker(()=>({ok:true,hidden:false}));

    const {body}=await bulk({ids:[ID_A,ID_B],hide:false});

    expect(body).toMatchObject({updated:2,failed:0});
    expect(calls.every(c=>c.body.hideLastSeen===false)).toBe(true);
    expect(accountData(ID_A).hideLastSeen).toBe(false);
    expect(accountData(ID_B).lastSeenPrivacy).toMatchObject({hidden:false,applied:true});
  });

  it('валидация: пустой список, больше 50, hide не boolean → 400 без вызова воркера',async()=>{
    const calls=stubWorker(()=>({ok:true,hidden:true}));
    const many=Array.from({length:51},(_,i)=>`66666666-6666-4666-8666-${String(i).padStart(12,'0')}`);

    expect((await bulk({ids:[],hide:true})).status).toBe(400);
    expect((await bulk({ids:many,hide:true})).status).toBe(400);
    expect((await bulk({ids:[ID_A],hide:'yes'})).status).toBe(400);
    expect((await bulk({ids:['not-a-uuid'],hide:true})).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('сбой воркера: общее сообщение без внутренних деталей',async()=>{
    await addLiveAccount(ID_A,'QUFB');
    const errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    stubWorker(()=>new Error('ECONNREFUSED internal worker 10.0.0.5:8790 stack at /srv/app'));

    const {body}=await bulk({ids:[ID_A],hide:true});

    expect(body).toMatchObject({updated:0,failed:1});
    expect(body.results[0].error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(LEAKY);
    expect(JSON.stringify(accountData(ID_A))).not.toMatch(LEAKY);
    expect(errSpy).toHaveBeenCalled();
  });

  it('ответ воркера 5xx: общее сообщение без внутренних деталей',async()=>{
    await addLiveAccount(ID_A,'QUFB');
    vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('ECONNREFUSED internal worker 10.0.0.5:8790 stack at /srv/app',{status:502})));

    const {body}=await bulk({ids:[ID_A],hide:true});

    expect(body.results[0]).toMatchObject({id:ID_A,ok:false});
    expect(body.results[0].error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(LEAKY);
  });
});
