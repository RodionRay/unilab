import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {
  ACCOUNT_STATUS_LABELS,
  accountStatusTone,
  applyQuotaCooldownIfExhausted,
  canPollDmInbox,
  isAccountUsable,
  keepServerOwnedAccountFields,
  moscowDayKey,
  needsAccountRecheck,
  suspectRecheckHours,
} from '@/lib/telegram-accounts';
import {evaluateAccountJoinReadiness,isPermanentlyDeadAccount,planGroupHeal} from '@/lib/processes/join-flow';
import {evaluateScanGate} from '@/lib/processes/scan-flow';

const DEAD_A='a0000000-0000-4000-8000-00000000000a';
const DEAD_B='b0000000-0000-4000-8000-00000000000b';
const LIVE='c0000000-0000-4000-8000-00000000000c';
const TASK='d0000000-0000-4000-8000-00000000000d';
const GROUP='e0000000-0000-4000-8000-00000000000e';
const LEAD='f0000000-0000-4000-8000-00000000000f';
const AUD='a1000000-0000-4000-8000-0000000000a1';
const INV='a2000000-0000-4000-8000-0000000000a2';
const HOUR=3600_000;
const DELETED_ANSWER={ok:false,status:'deleted',error:'Аккаунт удалён Telegram (USER_DEACTIVATED)'};
const SUSPECT_ANSWER={ok:false,status:'active',deletedSuspect:true,error:'Аккаунт не резолвит даже @telegram и @durov — похоже, Telegram удалил аккаунт'};

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}|undefined;
  return row?JSON.parse(row.data):null;
}
async function addAccount(id:string,data:Record<string,unknown>={}){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
function stubWorker(answer:(path:string)=>Record<string,unknown>){
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    const path=new URL(String(url)).pathname;
    calls.push(path);
    return Response.json(answer(path));
  }));
  return calls;
}

describe('статус deleted — аккаунт удалён Telegram',()=>{
  it('никогда не годится в работу и считается мёртвым насовсем',()=>{
    expect(ACCOUNT_STATUS_LABELS.deleted).toBe('Удалён Telegram');
    expect(accountStatusTone('deleted')).toBe('danger');
    expect(isAccountUsable({status:'deleted'})).toBe(false);
    expect(canPollDmInbox({status:'deleted'})).toBe(false);
    expect(isPermanentlyDeadAccount('deleted')).toBe(true);
    expect(evaluateScanGate({status:'deleted'})).toMatchObject({ok:false,reason:'hard_dead'});
    expect(evaluateAccountJoinReadiness({status:'deleted'})).toMatchObject({ok:false,reason:'deleted'});
  });

  it('исчерпанный лимит не превращает deleted в отлёжку',()=>{
    const data={status:'deleted',limits:{invite:1},joinsToday:5,joinsDay:moscowDayKey()};

    expect(applyQuotaCooldownIfExhausted(data).status).toBe('deleted');
  });

  it('вступившая группа удалённого аккаунта уходит на живой',()=>{
    expect(planGroupHeal({group:{membership:'joined',accountId:DEAD_A},accountStatus:'deleted'})).toBe('reassign');
  });

  it('мягкий признак удаления исключает активный аккаунт и отправляет его на перепроверку',()=>{
    expect(needsAccountRecheck({status:'active'})).toBe(false);
    expect(needsAccountRecheck({status:'active',deletedSuspectAt:'2026-10-01T00:00:00.000Z'})).toBe(true);
    expect(needsAccountRecheck({status:'frozen'})).toBe(true);
    expect(isAccountUsable({status:'active',controlBlindSince:'2026-10-01T00:00:00.000Z'})).toBe(false);
  });

  it('часы до подтверждения считаются от первой мягкой проверки',()=>{
    const now=Date.parse('2026-10-01T12:00:00Z');

    expect(suspectRecheckHours({controlBlindSince:new Date(now-2*HOUR).toISOString()},now)).toBe(4);
    expect(suspectRecheckHours({},now)).toBeNull();
  });

  it('форма аккаунта не ставит и не снимает deleted и признаки блокировки',()=>{
    expect(keepServerOwnedAccountFields({status:'active',deletedSuspectAt:'t'},{status:'deleted',deletedSuspectAt:''}))
      .toMatchObject({status:'active',deletedSuspectAt:'t'});
    expect(keepServerOwnedAccountFields({status:'deleted'},{status:'active'}).status).toBe('deleted');
    expect(keepServerOwnedAccountFields({},{status:'deleted',controlBlindSince:'t'})).toEqual({status:'setup'});
  });
});

describe('маршрут: проверка, «слепой» join и чистка удалённых',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare("DELETE FROM records WHERE id=? OR kind='mailing_task'").run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const purge=async(ids:string[])=>POST(postRequest({action:'delete_telegram_deleted_accounts',ids}));

  it('жёсткий сигнал (USER_DEACTIVATED) ставит deleted без смены прокси',async()=>{
    await addAccount(DEAD_A,{deletedSuspectAt:new Date().toISOString()});
    const calls=stubWorker(()=>DELETED_ANSWER);

    const res=await POST(postRequest({action:'check_account',id:DEAD_A}));

    expect(await res.json()).toMatchObject({result:{ok:false,status:'deleted'}});
    expect(calls).toEqual(['/check-account']);
    expect(rec(DEAD_A).status).toBe('deleted');
  });

  it('мягкий сигнал (@telegram и @durov не видны) — только подозрение с первой датой, не deleted',async()=>{
    await addAccount(DEAD_A);
    stubWorker(()=>SUSPECT_ANSWER);

    await POST(postRequest({action:'check_account',id:DEAD_A}));

    expect(rec(DEAD_A).status).toBe('active');
    expect(Date.parse(rec(DEAD_A).controlBlindSince)).toBeGreaterThan(Date.now()-60_000);
    expect(isAccountUsable(rec(DEAD_A))).toBe(false);
  });

  it('повтор мягкого сигнала раньше 6 ч оставляет первую дату и не делает deleted',async()=>{
    const first=new Date(Date.now()-HOUR).toISOString();
    await addAccount(DEAD_A,{controlBlindSince:first});
    stubWorker(()=>SUSPECT_ANSWER);

    await POST(postRequest({action:'check_account',id:DEAD_A}));

    expect(rec(DEAD_A)).toMatchObject({status:'active',controlBlindSince:first});
  });

  it('мягкий сигнал через 6 ч после первого подтверждает deleted',async()=>{
    await addAccount(DEAD_A,{controlBlindSince:new Date(Date.now()-7*HOUR).toISOString()});
    stubWorker(()=>SUSPECT_ANSWER);

    await POST(postRequest({action:'check_account',id:DEAD_A}));

    expect(rec(DEAD_A).status).toBe('deleted');
  });

  it('чистая проверка снимает признаки подозрения',async()=>{
    await addAccount(LIVE,{deletedSuspectAt:new Date().toISOString(),controlBlindSince:new Date().toISOString()});
    stubWorker(()=>({ok:true,status:'active',profile:{username:'live'}}));

    await POST(postRequest({action:'check_account',id:LIVE}));

    expect(rec(LIVE)).toMatchObject({status:'active',deletedSuspectAt:'',controlBlindSince:''});
    expect(isAccountUsable(rec(LIVE))).toBe(true);
  });

  it('«слепой» ответ на вступление ставит аккаунт на перепроверку, а не удаляет его',async()=>{
    await addAccount(DEAD_A);
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:DEAD_A});
    stubWorker(()=>({ok:false,status:'error',join:'missing',usernameMissing:true,accountBlind:true,error:'Аккаунт не резолвит даже @telegram'}));

    await POST(postRequest({action:'join_group',id:GROUP}));

    expect(rec(DEAD_A).status).toBe('active');
    expect(Date.parse(rec(DEAD_A).deletedSuspectAt)).toBeGreaterThan(Date.now()-60_000);
  },15_000);

  it('«Перепроверить проблемные» берёт и подозрительные активные аккаунты',async()=>{
    await addAccount(DEAD_A,{deletedSuspectAt:new Date().toISOString()});
    await addAccount(LIVE);
    const calls=stubWorker(()=>DELETED_ANSWER);

    const body=await (await POST(postRequest({action:'check_accounts',mode:'problem'}))).json() as {checked:number};

    expect(body.checked).toBe(1);
    expect(calls).toEqual(['/check-account']);
    expect(rec(LIVE).status).toBe('active');
  });

  it('чистка удаляет только подтверждённые id со статусом deleted и пишет журнал',async()=>{
    await addAccount(DEAD_A,{status:'deleted',username:'deleted_farm_acc'});
    await addAccount(DEAD_B,{status:'deleted'});
    await addAccount(LIVE,{deletedSuspectAt:new Date().toISOString()});
    const calls=stubWorker(()=>({ok:false,error:'not stubbed'}));

    const res=await purge([DEAD_A,LIVE]);

    expect(await res.json()).toMatchObject({ok:true,deleted:1});
    expect(rec(DEAD_A)).toBeNull();
    expect(rec(DEAD_B)).not.toBeNull();
    expect(rec(LIVE)).not.toBeNull();
    expect(calls).toEqual([]);
    expect(JSON.stringify(rec(SETTINGS_ID)?.rescanLog||[])).toContain('deleted_farm_acc');
  });

  it('чистка отвязывает группы, лиды, аудиторию и задачи; пустую задачу ставит на паузу',async()=>{
    await addAccount(DEAD_A,{status:'deleted'});
    await addAccount(LIVE);
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'joined',status:'active',joinedAt:'2026-09-01T00:00:00.000Z',accountId:DEAD_A,joinedAccountId:DEAD_A});
    addRecord(LEAD,'lead',{name:'L',accountId:DEAD_A});
    addRecord(TASK,'mailing_task',{name:'M',status:'running',accountIds:[DEAD_A]});
    addRecord(AUD,'audience_task',{name:'A',status:'paused',accountIds:[DEAD_A,LIVE],sourceAccountId:DEAD_A});
    addRecord(INV,'invite_task',{name:'I',status:'completed',accountIds:[DEAD_A]});

    const body=await (await purge([DEAD_A])).json();

    expect(body).toMatchObject({ok:true,deleted:1,groupsDetached:1});
    expect(rec(GROUP)).toMatchObject({accountId:'',joinedAccountId:''});
    expect(rec(LEAD).accountId).toBe('');
    expect(rec(AUD)).toMatchObject({accountIds:[LIVE],sourceAccountId:'',status:'paused'});
    expect(rec(TASK)).toMatchObject({accountIds:[],status:'paused'});
    expect(String(rec(TASK).error)).toContain('аккаунт');
    expect(rec(INV)).toMatchObject({accountIds:[],status:'completed'});
  });

  it('группа, уже переназначенная параллельно, не теряет новый аккаунт',async()=>{
    await addAccount(DEAD_A,{status:'deleted'});
    await addAccount(LIVE);
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',accountId:LIVE,joinedAccountId:''});

    await purge([DEAD_A]);

    expect(rec(GROUP).accountId).toBe(LIVE);
  });

  it('чистка без подтверждённых id ничего не трогает',async()=>{
    await addAccount(LIVE);

    const res=await purge([]);

    expect(await res.json()).toMatchObject({ok:true,deleted:0,groupsDetached:0});
    expect(rec(LIVE)).not.toBeNull();
  });

  it('сохранение формы аккаунта не ставит и не снимает deleted и сигналы подозрения',async()=>{
    // Fictional numbers (+1 555 01xx range): the form schema requires a phone.
    await addAccount(LIVE,{phone:'+15550100001',deletedSuspectAt:'2026-10-01T00:00:00.000Z',resolveBlindUntil:'2026-10-01T06:00:00.000Z'});
    await addAccount(DEAD_A,{phone:'+15550100002',status:'deleted'});

    const live=await POST(postRequest({action:'save',kind:'account',id:LIVE,data:{...rec(LIVE),status:'deleted',deletedSuspectAt:'',resolveBlindUntil:''}}));
    const dead=await POST(postRequest({action:'save',kind:'account',id:DEAD_A,data:{...rec(DEAD_A),status:'active'}}));

    expect([live.status,dead.status]).toEqual([200,200]);
    expect(rec(LIVE).resolveBlindUntil).toBe('2026-10-01T06:00:00.000Z');
    expect(rec(LIVE)).toMatchObject({status:'active',deletedSuspectAt:'2026-10-01T00:00:00.000Z'});
    expect(rec(DEAD_A).status).toBe('deleted');
  });

  it('обновление профиля с ответом frozen не перетирает deleted',async()=>{
    await addAccount(DEAD_A,{status:'deleted'});
    stubWorker(()=>({ok:false,status:'frozen',error:'FROZEN_METHOD_INVALID'}));

    await POST(postRequest({action:'apply_account_profiles',ids:[DEAD_A],about:'Сервис',pushToTelegram:true}));

    expect(rec(DEAD_A).status).toBe('deleted');
  },15_000);
});
