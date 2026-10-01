import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {accountTelegramBlock,isAccountJoinBlocked,isAccountUsable,keepServerOwnedAccountFields} from '@/lib/telegram-accounts';
import {evaluateAccountJoinReadiness,isJoinFarmCandidate,planGroupHeal} from '@/lib/processes/join-flow';

const NOW=Date.parse('2026-10-01T12:00:00Z');
const HOUR=3600_000;
const iso=(t:number)=>new Date(t).toISOString();
const ready={status:'active',limits:{invite:40}};
const BLIND_ERROR='Аккаунт не резолвит даже @telegram — ограничен Telegram, @x тут ни при чём';

/** Every Telegram block signal: any one of them keeps the account out of every join. */
const BLOCKED:[string,Record<string,unknown>][]=[
  ['spamblock',{status:'spamblock'}],
  ['frozen',{status:'frozen'}],
  ['deleted',{status:'deleted'}],
  ['unauthorized',{status:'unauthorized'}],
  ['active resolveBlindUntil',{resolveBlindUntil:iso(NOW+HOUR)}],
  ['expired resolveBlindUntil without a clean recheck',{resolveBlindUntil:iso(NOW-HOUR)}],
  ['blind join error',{error:BLIND_ERROR}],
  ['deletedSuspectAt',{deletedSuspectAt:iso(NOW-HOUR)}],
  ['controlBlindSince',{controlBlindSince:iso(NOW-HOUR)}],
  ['join FloodWait',{joinFloodUntil:iso(NOW+10*60_000)}],
  ['FloodWait of another call',{floodUntil:iso(NOW+10*60_000)}],
];

describe('isAccountJoinBlocked — один предикат для всех путей вступления',()=>{
  it.each(BLOCKED)('%s блокирует вступления',(_label,patch)=>{
    const acc={...ready,...patch};

    expect(isAccountJoinBlocked(acc,NOW)).toBe(true);
    expect(evaluateAccountJoinReadiness(acc,{now:NOW}).ok).toBe(false);
    expect(isJoinFarmCandidate(acc,{now:NOW})).toBe(false);
  });

  it('чистый активный аккаунт не заблокирован',()=>{
    expect(accountTelegramBlock(ready,NOW)).toBeNull();
    expect(isJoinFarmCandidate(ready,{now:NOW})).toBe(true);
  });

  it('подозрение исключает аккаунт и из остальной работы',()=>{
    expect(isAccountUsable({...ready,resolveBlindUntil:iso(NOW-HOUR)})).toBe(false);
    expect(isAccountUsable({...ready,error:BLIND_ERROR})).toBe(false);
  });

  it('форма аккаунта не стирает ошибку «слепого» ответа',()=>{
    expect(keepServerOwnedAccountFields({status:'active',error:BLIND_ERROR},{status:'active',error:''}).error).toBe(BLIND_ERROR);
  });

  it('автопочинка снимает ожидающую группу с заблокированного аккаунта, даже если она отложена',()=>{
    const group={accountId:'a',joinWanted:true,joinNextAt:iso(Date.now()+5*HOUR)};

    expect(planGroupHeal({group,accountStatus:'active',accountJoinBlock:'suspect'})).toBe('reassign');
    expect(planGroupHeal({group,accountStatus:'active',accountJoinBlock:null})).toBe('wait');
  });

  it('вступившая группа уходит с подозрительного аккаунта, но не с аккаунта на FloodWait',()=>{
    const group={accountId:'a',membership:'joined',joinedAt:iso(NOW)};

    expect(planGroupHeal({group,accountStatus:'active',accountJoinBlock:'suspect'})).toBe('reassign');
    expect(planGroupHeal({group,accountStatus:'active',accountJoinBlock:'flood'})).toBe('keep');
  });

  it('не возвращает группу прежнему заблокированному аккаунту',()=>{
    const group={accountId:'b',joinedAccountId:'a',joinWanted:true};

    expect(planGroupHeal({group,accountStatus:'active',previousAccountStatus:'active',previousAccountJoinBlock:'suspect'})).not.toBe('restore_previous');
  });
});

const BLOCKED_ID='a0000000-0000-4000-8000-00000000000a';
const LIVE_ID='c0000000-0000-4000-8000-00000000000c';
const LIVE_B='b0000000-0000-4000-8000-00000000000b';
const GROUP='e0000000-0000-4000-8000-00000000000e';

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string}|undefined;
  return row?JSON.parse(row.data):null;
}
async function addAccount(id:string,data:Record<string,unknown>={}){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40,memberInvite:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
type Call={path:string;accountId:string;body:Record<string,unknown>};
/** The sealed session carries the account id as zipBase64, so every worker call names its account. */
function stubWorker(answer:(path:string,accountId:string)=>Record<string,unknown>){
  const calls:Call[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:{body?:string})=>{
    const path=new URL(String(url)).pathname;
    const body=JSON.parse(String(init?.body||'{}')) as Record<string,unknown>;
    const accountId=String(body.zipBase64||'');
    calls.push({path,accountId,body});
    return Response.json(answer(path,accountId));
  }));
  return calls;
}
const joinsBy=(calls:Call[],id:string)=>calls.filter(c=>c.path==='/join-group'&&c.accountId===id);

describe('маршрут: заблокированный аккаунт никогда не вступает',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare("DELETE FROM records WHERE id=? OR kind='mailing_task'").run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    // Blind on @telegram the day before, timer expired, still 'active'.
    await addAccount(BLOCKED_ID,{resolveBlindUntil:iso(Date.now()-HOUR),error:BLIND_ERROR});
    await addAccount(LIVE_ID);
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('join_group: группа на заблокированном аккаунте вступает живым',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:BLOCKED_ID});
    const calls=stubWorker(()=>({ok:true,join:'joined',status:'active'}));

    await POST(postRequest({action:'join_group',id:GROUP}));

    expect(joinsBy(calls,BLOCKED_ID)).toEqual([]);
    expect(joinsBy(calls,LIVE_ID)).toHaveLength(1);
  },15_000);

  it('join_group: обновление peer вступившей группы не идёт через заблокированный аккаунт',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'joined',status:'active',joinedAt:iso(Date.now()-HOUR),accountId:BLOCKED_ID});
    const calls=stubWorker(()=>({ok:true,join:'already'}));

    const res=await POST(postRequest({action:'join_group',id:GROUP}));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({accountUnavailable:true});
    expect(calls).toEqual([]);
  });

  it('join_group: «слепой» ответ сразу исключает аккаунт из вступлений',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:LIVE_ID,joinBlindAccounts:[BLOCKED_ID]});
    stubWorker(()=>({ok:false,status:'error',join:'missing',usernameMissing:true,accountBlind:true,error:BLIND_ERROR}));

    await POST(postRequest({action:'join_group',id:GROUP}));

    const acc=rec(LIVE_ID);
    expect(isAccountJoinBlocked(acc)).toBe(true);
    expect(isAccountJoinBlocked(acc,Date.now()+7*HOUR)).toBe(true);
    expect(acc.deletedSuspectAt).toBeTruthy();
  },15_000);

  it('join_group: «не видит @» при сбое контрольной проверки не ставит группе ошибку и попытку',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:LIVE_ID});
    stubWorker(()=>({ok:false,status:'setup',join:'missing',usernameMissing:false,accountBlind:false,controlUnknown:true,
      error:'Слот не смог проверить себя контрольным @telegram — @live_chat не штрафуем (ValueError: No user has "live_chat" as username)'}));

    await POST(postRequest({action:'join_group',id:GROUP}));

    expect(rec(GROUP).status).not.toBe('error');
    expect(rec(GROUP).joinAttempts||0).toBe(0);
    expect(isAccountJoinBlocked(rec(LIVE_ID))).toBe(false);
  },15_000);

  it('join_group: заморозка при вступлении переназначает вступившую группу без просьбы к владельцу',async()=>{
    await addAccount(LIVE_B);
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'joined',status:'active',joinedAt:iso(Date.now()-HOUR),accountId:LIVE_ID});
    stubWorker(()=>({ok:false,status:'frozen',join:'frozen',error:'Аккаунт заморожен Telegram (FROZEN_METHOD_INVALID). «вступление в канал/группу» недоступно — назначьте другой рабочий аккаунт.'}));

    const body=await (await POST(postRequest({action:'join_group',id:GROUP}))).json() as Record<string,unknown>;

    expect(rec(LIVE_ID).status).toBe('frozen');
    expect(rec(GROUP).accountId).toBe(LIVE_B);
    expect(JSON.stringify(body)).not.toContain('назначьте');
  },15_000);

  it('heal: ожидающая группа уходит с заблокированного аккаунта на живой',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,
      accountId:BLOCKED_ID,joinNextAt:iso(Date.now()+5*HOUR)});
    stubWorker(()=>({ok:false,error:'not stubbed'}));

    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(rec(GROUP).accountId).toBe(LIVE_ID);
  });

  it('scan_group: заблокированный аккаунт не сканирует',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:BLOCKED_ID});
    const calls=stubWorker(()=>({ok:true,messages:[]}));

    await POST(postRequest({action:'scan_group',id:GROUP,force:true}));

    expect(calls.filter(c=>c.accountId===BLOCKED_ID)).toEqual([]);
  });

  it('scan_group: аккаунту на FloodWait запрещено вступать в обсуждение',async()=>{
    await addAccount(LIVE_B,{joinFloodUntil:iso(Date.now()+HOUR)});
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'joined',status:'active',joinedAt:iso(Date.now()-HOUR),accountId:LIVE_B});
    const calls=stubWorker(()=>({ok:true,messages:[]}));

    await POST(postRequest({action:'scan_group',id:GROUP,force:true}));

    const scans=calls.filter(c=>c.path==='/scan-group');
    expect(scans).toHaveLength(1);
    expect(scans[0]!.body.allowJoin).toBe(false);
  });

  it('scan_group: «слепой» скан не ставит живой группе ошибку и помечает аккаунт',async()=>{
    addRecord(GROUP,'group',{name:'Г',url:'https://t.me/live_chat',membership:'joined',status:'active',joinedAt:iso(Date.now()-HOUR),accountId:LIVE_ID});
    stubWorker(()=>({ok:false,status:'error',join:'missing',usernameMissing:true,accountBlind:true,messages:[],error:BLIND_ERROR}));

    const res=await POST(postRequest({action:'scan_group',id:GROUP,force:true}));

    expect(res.status).toBe(409);
    expect(rec(GROUP).status).not.toBe('error');
    expect(rec(GROUP).accountId).toBe(LIVE_ID);
    expect(isAccountJoinBlocked(rec(LIVE_ID))).toBe(true);
  });

  it('tick_invite: заблокированный аккаунт задачи не вступает в целевую группу',async()=>{
    const AUD='a1000000-0000-4000-8000-0000000000a1';
    const TASK='d0000000-0000-4000-8000-00000000000d';
    addRecord(AUD,'audience_task',{name:'A',url:'https://t.me/src_chat',sourceKind:'chat',accountIds:[LIVE_ID],status:'completed',log:[]});
    addRecord('a3000000-0000-4000-8000-0000000000a3','audience_user',{taskId:AUD,userId:'100',username:'client100',invited:false});
    addRecord(TASK,'invite_task',{name:'I',audienceTaskId:AUD,targetUrl:'https://t.me/target_chat',accountIds:[BLOCKED_ID,LIVE_ID],
      status:'running',batchSize:1,done:0,invitedToday:0,pauseFromSec:1,pauseToSec:1,stopDisconnectedPct:100,log:[]});
    const calls=stubWorker(path=>path==='/join-group'?{ok:true,join:'already'}:{ok:true,results:[]});

    for(let i=0;i<3;i++)await POST(postRequest({action:'tick_invite',id:TASK}));

    expect(calls.filter(c=>c.accountId===LIVE_ID).length).toBeGreaterThan(0);
    expect(calls.filter(c=>c.accountId===BLOCKED_ID)).toEqual([]);
  },15_000);

  it('tick_audience: заблокированный аккаунт задачи не вступает в источник',async()=>{
    const AUD='a1000000-0000-4000-8000-0000000000a1';
    addRecord(AUD,'audience_task',{name:'A',url:'https://t.me/src_chat',status:'running',accountIds:[BLOCKED_ID,LIVE_ID],collected:0,hasMore:true,
      collectMode:'discussions',rangeMode:'count',messageLimit:5000,cursor:'',log:[]});
    const calls=stubWorker(path=>path==='/join-group'?{ok:true,join:'joined'}:{ok:false,join:'need_join',users:[],error:'Сначала вступите'});

    for(let i=0;i<3;i++)await POST(postRequest({action:'tick_audience',id:AUD}));

    expect(calls.filter(c=>c.accountId===LIVE_ID).length).toBeGreaterThan(0);
    expect(calls.filter(c=>c.accountId===BLOCKED_ID)).toEqual([]);
  },15_000);
});
