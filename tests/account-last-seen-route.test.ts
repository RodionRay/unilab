import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';

const LIVE_ID='66666666-6666-4666-8666-666666666666';
const LEAKY=/10\.0\.0\.5|stack|ECONNREFUSED/;
type Applied={ok:boolean;applied:boolean;hidden:boolean;error:string};

type Call={url:string;body:Record<string,unknown>};

function stubWorker(answer:Record<string,unknown>|Error){
  const calls:Call[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    calls.push({url:String(url),body:JSON.parse(String(init.body))});
    if(answer instanceof Error)throw answer;
    return Response.json(answer);
  }));
  return calls;
}

function accountData(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}

async function addLiveAccount(extra:Record<string,unknown>={}){
  const secret=await seal(JSON.stringify({kind:'session',zipBase64:'UEsDBA==',apiId:1,apiHash:'h'}),OWNER);
  addRecord(LIVE_ID,'account',{name:'Live',phone:'+79990002233',status:'active',proxyId:'',joinsToday:3,...extra},secret);
}

describe('apply_account_last_seen: скрыть «был в сети»',()=>{
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
  });
  afterEach(()=>{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('воркер применил → флаг и состояние «применено» в записи, остальные поля целы',async()=>{
    await addLiveAccount();
    const calls=stubWorker({ok:true,hidden:true});

    const res=await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}));
    const body=await res.json() as Applied;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ok:true,applied:true,hidden:true,error:''});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/set-last-seen-privacy$/);
    expect(calls[0].body).toMatchObject({hideLastSeen:true,format:'session',zipBase64:'UEsDBA=='});
    const data=accountData(LIVE_ID);
    expect(data.hideLastSeen).toBe(true);
    expect(data.lastSeenPrivacy).toMatchObject({hidden:true,applied:true,error:''});
    expect(Date.parse(data.lastSeenPrivacy.at)).not.toBeNaN();
    expect(data.joinsToday).toBe(3);
  });

  it('выключение отправляет hideLastSeen:false',async()=>{
    await addLiveAccount({hideLastSeen:true});
    const calls=stubWorker({ok:true,hidden:false});

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:false}))).json() as Applied;

    expect(calls[0].body.hideLastSeen).toBe(false);
    expect(body).toMatchObject({applied:true,hidden:false});
    expect(accountData(LIVE_ID).hideLastSeen).toBe(false);
  });

  it('повтор того же значения безопасен: то же состояние',async()=>{
    await addLiveAccount();
    stubWorker({ok:true,hidden:true});

    await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}));
    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(body).toMatchObject({applied:true,hidden:true});
    expect(accountData(LIVE_ID).lastSeenPrivacy).toMatchObject({hidden:true,applied:true});
  });

  it('ошибка Telegram → «не применено» с причиной, желаемый флаг сохранён',async()=>{
    await addLiveAccount();
    stubWorker({ok:false,error:'Telegram просит подождать 42 с (FloodWait)'});

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(body).toMatchObject({ok:true,applied:false,hidden:true,error:'Telegram просит подождать 42 с (FloodWait)'});
    const data=accountData(LIVE_ID);
    expect(data.hideLastSeen).toBe(true);
    expect(data.lastSeenPrivacy).toMatchObject({hidden:true,applied:false,error:'Telegram просит подождать 42 с (FloodWait)'});
    expect(data.status).toBe('active');
  });

  it('заморозка от воркера помечает аккаунт frozen',async()=>{
    await addLiveAccount();
    stubWorker({ok:false,status:'frozen',error:'Telegram ограничил смену приватности (заморозка)'});

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(body.applied).toBe(false);
    expect(accountData(LIVE_ID).status).toBe('frozen');
  });

  it('сбой воркера: общее сообщение без внутренних деталей',async()=>{
    await addLiveAccount();
    const errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    stubWorker(new Error('ECONNREFUSED internal worker 10.0.0.5:8790 stack at /srv/app'));

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(body).toMatchObject({applied:false,hidden:true});
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(LEAKY);
    expect(JSON.stringify(accountData(LIVE_ID))).not.toMatch(LEAKY);
    expect(errSpy).toHaveBeenCalled();
  });

  it('без сессии воркер не вызывается',async()=>{
    addRecord(LIVE_ID,'account',{name:'NoSess',phone:'+79990002233',status:'setup',proxyId:''},null);
    const calls=stubWorker({ok:true,hidden:true});

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({applied:false,hidden:true,error:'Нет сессии'});
  });

  it('hide не boolean → 400, чужой/несуществующий id → 404',async()=>{
    const calls=stubWorker({ok:true,hidden:true});

    expect((await POST(postRequest({action:'apply_account_last_seen',id:ACCOUNT_ID,hide:'yes'}))).status).toBe(400);
    expect((await POST(postRequest({action:'apply_account_last_seen',id:'77777777-7777-4777-8777-777777777777',hide:true}))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('save хранит hideLastSeen, но не даёт клиенту подделать состояние применения',async()=>{
    await addLiveAccount({hideLastSeen:true,lastSeenPrivacy:{hidden:true,applied:false,at:'2026-10-01T00:00:00.000Z',error:'FloodWait'}});

    const res=await POST(postRequest({action:'save',kind:'account',id:LIVE_ID,data:{
      name:'Live',phone:'+79990002233',status:'active',hideLastSeen:true,
      lastSeenPrivacy:{hidden:true,applied:true,at:'2030-01-01T00:00:00.000Z',error:''},
    }}));

    expect(res.status).toBe(200);
    const data=accountData(LIVE_ID);
    expect(data.hideLastSeen).toBe(true);
    expect(data.lastSeenPrivacy).toEqual({hidden:true,applied:false,at:'2026-10-01T00:00:00.000Z',error:'FloodWait'});
  });

  it('пока применение идёт, второй вызов получает 429 и воркер не зовёт',async()=>{
    await addLiveAccount({lastSeenPrivacyLease:new Date(Date.now()+30_000).toISOString()});
    const calls=stubWorker({ok:true,hidden:true});

    const res=await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}));

    expect(res.status).toBe(429);
    expect(calls).toHaveLength(0);
    expect(accountData(LIVE_ID).hideLastSeen).toBeUndefined();
  });

  it('просроченная аренда не мешает, после вызова аренда снята',async()=>{
    await addLiveAccount({lastSeenPrivacyLease:new Date(Date.now()-1_000).toISOString()});
    stubWorker({ok:true,hidden:true});

    const res=await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}));

    expect(res.status).toBe(200);
    expect(accountData(LIVE_ID).lastSeenPrivacyLease).toBeUndefined();
  });

  it('занятый воркер (429) — понятное «повторите позже»',async()=>{
    await addLiveAccount();
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false,error:'Воркер занят'},{status:429})));

    const body=await (await POST(postRequest({action:'apply_account_last_seen',id:LIVE_ID,hide:true}))).json() as Applied;

    expect(body.applied).toBe(false);
    expect(body.error).toMatch(/занят/);
    expect(accountData(LIVE_ID).lastSeenPrivacyLease).toBeUndefined();
  });

  it('новая или удалённая сессия сбрасывает состояние применения',async()=>{
    await addLiveAccount({hideLastSeen:true,lastSeenPrivacy:{hidden:true,applied:true,at:'2026-10-01T00:00:00.000Z',error:''}});
    const save=(extra:Record<string,unknown>)=>POST(postRequest({action:'save',kind:'account',id:LIVE_ID,data:{name:'Live',phone:'+79990002233',hideLastSeen:true},...extra}));

    expect((await save({secret:JSON.stringify({kind:'session',zipBase64:'UEsDBA=='})})).status).toBe(200);
    expect(accountData(LIVE_ID).lastSeenPrivacy).toBeUndefined();

    testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.lastSeenPrivacy',json(?)) WHERE id=?").run(JSON.stringify({hidden:true,applied:true,at:'x',error:''}),LIVE_ID);
    expect((await save({clearSecret:true})).status).toBe(200);
    expect(accountData(LIVE_ID).lastSeenPrivacy).toBeUndefined();
  });

  it('save нового аккаунта не принимает состояние применения от клиента',async()=>{
    const res=await POST(postRequest({action:'save',kind:'account',data:{
      name:'New',phone:'+79990003344',hideLastSeen:true,
      lastSeenPrivacy:{hidden:true,applied:true,at:'2030-01-01T00:00:00.000Z',error:''},
    }}));
    const {id}=await res.json() as {id:string};

    const data=accountData(id);
    expect(data.hideLastSeen).toBe(true);
    expect(data.lastSeenPrivacy).toBeUndefined();
  });
});
