import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {ACC_A,ACC_B,API_ID,CHAT_LEAD,addChatLead,addSealedAccount,dropHarnessAccount,readRecord,stubWorker} from './helpers/chats-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {GET,POST} from '@/app/api/workspace/route';

const post=(body:Record<string,unknown>)=>POST(postRequest(body));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reads arbitrary JSON
const json=async(r:Response|Promise<Response>):Promise<any>=>(await r).json();
const send=(text='Привет')=>post({action:'send_lead_message',id:CHAT_LEAD,mode:'dm',text});
const recentReply=()=>[{text:'Здравствуйте',mode:'dm',at:new Date().toISOString(),ok:true,error:'',messageId:'10',link:'',chatId:'777',from:'us'}];
const journal=()=>testDb().sqlite.prepare('SELECT account_id AS accountId,type,context,wait_sec AS waitSec FROM account_events ORDER BY at').all() as {accountId:string;type:string;context:string;waitSec:number|null}[];

describe('«вероятно заблокировал» и журнал штрафов через /api/workspace',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.spyOn(console,'error').mockImplementation(()=>{});
    dropHarnessAccount();
    try{testDb().sqlite.exec('DELETE FROM account_events;')}catch{/* table appears on first write */}
    await addSealedAccount(ACC_A,{});
    await addSealedAccount(ACC_B,{});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('USER_IS_BLOCKED при отправке → бейдж-сигнал у лида и событие peer_blocked у аккаунта',async()=>{
    addChatLead({replies:recentReply()});
    stubWorker(()=>({ok:false,errorCode:'USER_IS_BLOCKED',error:'Клиент заблокировал этот аккаунт (USER_IS_BLOCKED)'}));

    const res=await send();

    expect(res.status).toBe(502);
    const signal=readRecord(CHAT_LEAD).blockSignal as {accountId:string;reasons:{code:string}[]};
    expect(signal.accountId).toBe(ACC_A);
    expect(signal.reasons.map(r=>r.code)).toEqual(['blocked_error']);
    expect(journal()).toEqual([{accountId:ACC_A,type:'peer_blocked',context:'dm',waitSec:null}]);

    const list=await json(post({action:'account_events',accountId:ACC_A}));
    expect(list.events).toHaveLength(1);
    expect(list.events[0]).toMatchObject({type:'peer_blocked',context:'dm'});
  });

  it('FloodWait на ЛС попадает в журнал с секундами; повтор в ту же минуту не дублируется',async()=>{
    addChatLead({replies:recentReply()});
    stubWorker(()=>({ok:false,status:'flood',waitSec:420,error:'FloodWait 420с'}));

    expect((await send('раз')).status).toBe(429);
    await send('два');

    expect(journal()).toEqual([{accountId:ACC_A,type:'flood_wait',context:'dm',waitSec:420}]);
  });

  it('видимый профиль при отправке, потом скрыт в пакетной проверке → profile_hidden; не чаще раза в 6 ч',async()=>{
    addChatLead({replies:recentReply()});
    const {calls}=stubWorker(call=>call.path==='/send-message'
      ?{ok:true,chatId:'777',messageId:'11',senderAccessHash:'hash-a',peer:{status:'recently',wasOnline:0,photo:true,deleted:false}}
      :{ok:true,peers:[{userId:'777',status:'hidden',wasOnline:0,photo:false,deleted:false,outUnread:true,lastOutAt:Math.floor(Date.now()/1000)-60}]});

    expect((await send()).status).toBe(200);
    expect(readRecord(CHAT_LEAD).blockSignal).toMatchObject({accountId:ACC_A,visibleStatus:true,visiblePhoto:true,reasons:[]});

    const first=await json(post({action:'check_lead_blocks'}));
    expect(first).toMatchObject({ok:true,checked:1,changed:1,accountId:ACC_A});
    const peerCalls=calls.filter(c=>c.path==='/peer-status');
    expect(peerCalls).toHaveLength(1);
    expect(peerCalls[0]!.body.peers).toEqual([{userId:'777',accessHash:'hash-a'}]);
    const signal=readRecord(CHAT_LEAD).blockSignal as {reasons:{code:string;detail:string}[];checkedAt:string};
    expect(signal.reasons.map(r=>r.code)).toEqual(['profile_hidden']);
    expect(signal.reasons[0]!.detail).toContain('не прочитано');

    const second=await json(post({action:'check_lead_blocks'}));
    expect(second.checked).toBe(0);
    expect(calls.filter(c=>c.path==='/peer-status')).toHaveLength(1);
  });

  it('входящее сообщение клиента не нужно для проверки: лиды без нашего ЛС не проверяются',async()=>{
    addChatLead({replies:[]});
    const {calls}=stubWorker(()=>({ok:true,peers:[]}));

    const out=await json(post({action:'check_lead_blocks'}));

    expect(out.checked).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('сохранение лида из UI не стирает blockSignal (server-owned)',async()=>{
    addChatLead({replies:recentReply(),blockSignal:{accountId:ACC_A,reasons:[{code:'blocked_error',at:'2026-10-01T00:00:00.000Z',detail:'x'}]}});
    stubWorker(()=>({ok:true}));
    const lead=readRecord(CHAT_LEAD);

    await post({action:'save',kind:'lead',id:CHAT_LEAD,data:{...lead,blockSignal:undefined,name:'Новое имя'}});

    expect(readRecord(CHAT_LEAD).blockSignal).toMatchObject({accountId:ACC_A});
  });

  it('GET отдаёт счётчики 24ч/7д/всё по аккаунтам',async()=>{
    addChatLead({replies:recentReply()});
    stubWorker(call=>call.path==='/health'?{ok:true}:{ok:false,status:'spamblock',error:'PEER_FLOOD: Too many requests'});
    await send();

    const data=await json(GET());

    expect(data.accountPenalties[ACC_A]).toMatchObject({day:1,week:1,all:1});
  });
  it('FloodWait в пакетной проверке ставит аккаунту floodUntil; следующий вызов его не трогает',async()=>{
    addChatLead({replies:recentReply()});
    const {calls}=stubWorker(()=>({ok:false,status:'flood',waitSec:600,error:'FloodWait 600с',peers:[]}));

    const out=await json(post({action:'check_lead_blocks'}));

    expect(out).toMatchObject({ok:false,flood:true,accountId:ACC_A});
    expect(Date.parse(String(readRecord(ACC_A).floodUntil))).toBeGreaterThan(Date.now()+500_000);
    expect(journal()).toEqual([{accountId:ACC_A,type:'flood_wait',context:'peer_check',waitSec:600}]);
    // Лид проштампован до вызова; даже снятый штамп не заставит дёрнуть аккаунт под FloodWait
    const lead=readRecord(CHAT_LEAD);
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...lead,blockSignal:undefined}),CHAT_LEAD);
    await post({action:'check_lead_blocks'});
    expect(calls.filter(c=>c.path==='/peer-status')).toHaveLength(1);
  });

  it('пир с битым access_hash: hash у лида сбрасывается, остальные проверены',async()=>{
    addChatLead({replies:recentReply()});
    stubWorker(()=>({ok:true,peers:[],failed:[{userId:'777',error:'RPCError 400: PEER_ID_INVALID'}]}));

    await post({action:'check_lead_blocks'});

    expect(readRecord(CHAT_LEAD).senderAccessHash).toBe('');
    expect(readRecord(CHAT_LEAD).blockSignal).toMatchObject({accountId:ACC_A});
  });

  it('лиды мёртвого аккаунта штампуются без вызова воркера',async()=>{
    await addSealedAccount(ACC_A,{status:'unauthorized'});
    addChatLead({replies:recentReply()});
    const {calls}=stubWorker(()=>({ok:true,peers:[]}));

    const out=await json(post({action:'check_lead_blocks'}));

    expect(out.checked).toBe(0);
    expect(calls).toHaveLength(0);
    expect((readRecord(CHAT_LEAD).blockSignal as {checkedAt?:string}).checkedAt).toBeTruthy();
  });

  it('входящее ЛС от клиента снимает «вероятно заблокировал»; FloodWait входящих — в журнал',async()=>{
    addChatLead({replies:recentReply(),blockSignal:{accountId:ACC_A,reasons:[{code:'blocked_error',at:'2026-10-01T00:00:00.000Z',detail:'x'}]}});
    const ts=Math.floor(Date.now()/1000);
    stubWorker(call=>call.body.apiId===API_ID[ACC_A]
      ?{ok:true,complete:true,scanStartedTs:ts,messages:[{userId:'777',username:'client_nick',name:'Клиент',text:'Да',messageId:'905',at:new Date(ts*1000).toISOString(),ts,hasMedia:false}]}
      :{ok:false,status:'flood',waitSec:90,error:'FloodWait 90с',messages:[]});

    await post({action:'poll_dm_replies'});

    expect((readRecord(CHAT_LEAD).blockSignal as {reasons:unknown[]}).reasons).toEqual([]);
    expect(journal()).toEqual([{accountId:ACC_B,type:'flood_wait',context:'inbox',waitSec:90}]);
  });

  it('проверка уже ограниченного аккаунта не дублирует штраф @SpamBot',async()=>{
    stubWorker(()=>({ok:false,status:'spamblock',error:'@SpamBot: limited'}));

    await post({action:'check_account',id:ACC_A,deep:true,rotateProxy:false});
    await post({action:'check_account',id:ACC_A,deep:true,rotateProxy:false});

    expect(journal()).toEqual([{accountId:ACC_A,type:'spambot',context:'check',waitSec:null}]);
  });

  it('ошибки приватности получателя в журнале, но не в счётчиках штрафов',async()=>{
    addChatLead({replies:recentReply()});
    stubWorker(call=>call.path==='/health'?{ok:true}:{ok:false,errorCode:'USER_PRIVACY_RESTRICTED',error:'privacy'});
    await send();

    const data=await json(GET());

    expect(journal().map(x=>x.type)).toEqual(['privacy']);
    expect(data.accountPenalties[ACC_A]).toBeUndefined();
  });

  it('участник без раздела «Аккаунты» не видит журнал',async()=>{
    const {authorizeWorkspaceAction}=await import('@/lib/security/workspace-authz');
    const member={userId:'m',ownerId:OWNER,isOwner:false,role:'manager' as never,access:{chats:true} as never};
    expect(authorizeWorkspaceAction(member,'account_events',undefined).ok).toBe(false);
    expect(authorizeWorkspaceAction(member,'check_lead_blocks',undefined).ok).toBe(true);
    expect(authorizeWorkspaceAction({...member,role:'viewer' as never,access:{accounts:true} as never},'account_events',undefined).ok).toBe(true);
  });
});
