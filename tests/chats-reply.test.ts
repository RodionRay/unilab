import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,login,postRequest,resetWorkspace} from './helpers/workspace-harness';
import {ACC_A,ACC_B,CHAT_LEAD,addChatLead,addSealedAccount,dropHarnessAccount,readRecord,stubWorker} from './helpers/chats-fixture';
import {moscowDayKey} from '@/lib/telegram-accounts';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const send=(body:Record<string,unknown>)=>POST(postRequest({action:'send_lead_message',id:CHAT_LEAD,...body}));
const timeoutError=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});

describe('переписки · ответ лиду (send_lead_message)',()=>{
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

  it('REQ-C1: ответ в чат не перезаписывает senderId/username клиента данными группы',async()=>{
    addChatLead();
    stubWorker(()=>({ok:true,chatId:'-1001234567',chatUsername:'sellers_wb',messageId:'55',link:'https://t.me/sellers_wb/55'}));

    const res=await send({mode:'chat',text:'Ответили в группе'});

    expect(res.status).toBe(200);
    const lead=readRecord(CHAT_LEAD);
    expect(lead.senderId).toBe('777');
    expect(lead.senderUsername).toBe('client_nick');
    expect(lead.senderAccessHash).toBe('hash-a');
  });

  it('REQ-C1: chatId прошлого ответа в чат не используется как peer для лички',async()=>{
    addChatLead({senderId:'',replies:[{text:'в чат',mode:'chat',at:'2026-09-29T10:00:00.000Z',ok:true,error:'',messageId:'9',link:'',chatId:'1001234567',from:'us'}]});
    const {calls}=stubWorker(()=>({ok:true,chatId:'777',messageId:'56'}));

    await send({mode:'dm',text:'Пишу в личку'});

    expect(calls[0]?.body.senderId).not.toBe('1001234567');
    expect(calls[0]?.body.senderUsername).toBe('client_nick');
  });

  it('REQ-C5: при неудачной отправке с ротацией accountId переписки не меняется',async()=>{
    addChatLead({conversationOpen:false,replies:[]});
    await addSealedAccount(ACC_A,{status:'spamblock'});
    stubWorker(()=>({ok:false,error:'USER_PRIVACY_RESTRICTED'}));

    const res=await send({mode:'dm',text:'Привет'});

    expect(res.status).toBe(502);
    expect(readRecord(CHAT_LEAD).accountId).toBe(ACC_A);
  });

  it('REQ-C5: успешная отправка с ротацией закрепляет новый аккаунт',async()=>{
    addChatLead({conversationOpen:false,replies:[]});
    await addSealedAccount(ACC_A,{status:'spamblock'});
    stubWorker(()=>({ok:true,chatId:'777',messageId:'57'}));

    const res=await send({mode:'dm',text:'Привет'});

    expect(res.status).toBe(200);
    expect(readRecord(CHAT_LEAD).accountId).toBe(ACC_B);
  });

  it('REQ-C8: неудачная отправка не снимает needsManager и не ставит viewed',async()=>{
    addChatLead();
    stubWorker(()=>({ok:false,error:'PEER_ID_INVALID'}));

    await send({mode:'dm',text:'Привет'});

    const lead=readRecord(CHAT_LEAD);
    expect(lead.needsManager).toBe(true);
    expect(lead.viewed).toBe(false);
  });

  it('REQ-C8: успешная отправка снимает needsManager и ставит viewed',async()=>{
    addChatLead();
    stubWorker(()=>({ok:true,chatId:'777',messageId:'58'}));

    await send({mode:'dm',text:'Привет'});

    const lead=readRecord(CHAT_LEAD);
    expect(lead.needsManager).toBe(false);
    expect(lead.viewed).toBe(true);
  });

  it('REQ-C6: аккаунт открытой переписки на отлёжке → 429 без отправки',async()=>{
    addChatLead();
    await addSealedAccount(ACC_A,{status:'cooldown',cooldownUntil:new Date(Date.now()+3_600_000).toISOString()});
    const {calls}=stubWorker(()=>({ok:true}));

    const res=await send({mode:'dm',text:'Привет'});

    expect(res.status).toBe(429);
    expect((await res.json() as {error:string}).error).toMatch(/отлежк/i);
    expect(calls).toHaveLength(0);
  });

  it('REQ-C6: у аккаунта открытой переписки исчерпан дневной лимит → 429 без отправки',async()=>{
    addChatLead();
    await addSealedAccount(ACC_A,{messagesToday:10,messagesDay:moscowDayKey(),limits:{message:10}});
    const {calls}=stubWorker(()=>({ok:true}));

    const res=await send({mode:'dm',text:'Привет'});

    expect(res.status).toBe(429);
    expect((await res.json() as {error:string}).error).toMatch(/лимит/i);
    expect(calls).toHaveLength(0);
  });

  it('REQ-C4: таймаут приложения к воркеру длиннее очереди и задачи воркера (≥180 с)',async()=>{
    addChatLead();
    stubWorker(()=>({ok:true,chatId:'777',messageId:'59'}));
    const spy=vi.spyOn(AbortSignal,'timeout');

    await send({mode:'dm',text:'Привет'});

    expect(Math.max(...spy.mock.calls.map(c=>Number(c[0])))).toBeGreaterThanOrEqual(180_000);
  });

  it('REQ-C4: запись «отправляется» сохранена до вызова воркера',async()=>{
    addChatLead();
    let seen:Record<string,unknown>|undefined;
    stubWorker(()=>{
      seen=readRecord(CHAT_LEAD).replies.at(-1);
      return {ok:true,chatId:'777',messageId:'60'};
    });

    await send({mode:'dm',text:'Привет',clientMsgId:'k-1'});

    expect(seen).toMatchObject({text:'Привет',status:'pending',sendKey:'k-1'});
    expect(readRecord(CHAT_LEAD).replies.at(-1)).toMatchObject({status:'sent',ok:true,sendKey:'k-1'});
  });

  it('REQ-C4: после таймаута повтор того же сообщения не отправляет дубль',async()=>{
    addChatLead();
    let n=0;
    stubWorker(()=>{n++;throw timeoutError()});

    const first=await send({mode:'dm',text:'Привет',clientMsgId:'k-2'});
    const second=await send({mode:'dm',text:'Привет',clientMsgId:'k-2'});
    const third=await send({mode:'dm',text:'Привет'});

    expect(first.status).toBe(504);
    expect((await first.json() as {unknown?:boolean}).unknown).toBe(true);
    expect(second.status).toBe(409);
    expect(third.status).toBe(409);
    expect(n).toBe(1);
    const entries=readRecord(CHAT_LEAD).replies.filter(x=>x.text==='Привет');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({status:'unknown',ok:false});
  });

  it('REQ-C4: повтор уже доставленного clientMsgId возвращает прежний результат без отправки',async()=>{
    addChatLead();
    const {calls}=stubWorker(()=>({ok:true,chatId:'777',messageId:'61'}));

    await send({mode:'dm',text:'Привет',clientMsgId:'k-3'});
    const again=await send({mode:'dm',text:'Привет',clientMsgId:'k-3'});

    expect(again.status).toBe(200);
    expect((await again.json() as {duplicate?:boolean}).duplicate).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('REQ-C4: force после неизвестного результата отправляет повторно одной записью',async()=>{
    addChatLead();
    let fail=true;
    stubWorker(()=>{
      if(fail){fail=false;throw timeoutError()}
      return {ok:true,chatId:'777',messageId:'62'};
    });

    await send({mode:'dm',text:'Привет',clientMsgId:'k-4'});
    const forced=await send({mode:'dm',text:'Привет',clientMsgId:'k-4',force:true});

    expect(forced.status).toBe(200);
    const entries=readRecord(CHAT_LEAD).replies.filter(x=>x.text==='Привет');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({status:'sent',ok:true});
  });

  it('REQ-C4: воркер занят (429) — запись failed, повтор разрешён',async()=>{
    addChatLead();
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false,error:'Воркер занят'},{status:429})));

    const res=await send({mode:'dm',text:'Привет',clientMsgId:'k-5'});

    expect(res.status).toBe(429);
    expect(readRecord(CHAT_LEAD).replies.at(-1)).toMatchObject({status:'failed',ok:false});
    stubWorker(()=>({ok:true,chatId:'777',messageId:'63'}));
    expect((await send({mode:'dm',text:'Привет',clientMsgId:'k-5'})).status).toBe(200);
  });

  it('REQ-C4: повтор неудачной отправки тем же ключом заменяет запись failed одной записью sent',async()=>{
    addChatLead();
    let fail=true;
    stubWorker(()=>{
      if(fail){fail=false;return {ok:false,error:'PEER_FLOOD'}}
      return {ok:true,chatId:'777',messageId:'64'};
    });

    const first=await send({mode:'dm',text:'Повтор',clientMsgId:'k-6'});
    const retry=await send({mode:'dm',text:'Повтор',clientMsgId:'k-6'});

    expect(first.status).toBe(502);
    expect(retry.status).toBe(200);
    const entries=readRecord(CHAT_LEAD).replies.filter(x=>x.text==='Повтор');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({status:'sent',ok:true,sendKey:'k-6'});
  });

  it('REQ-C4: повтор неудачной отправки новым ключом (после перезагрузки) тоже заменяет failed',async()=>{
    addChatLead();
    let fail=true;
    stubWorker(()=>{
      if(fail){fail=false;return {ok:false,error:'PEER_FLOOD'}}
      return {ok:true,chatId:'777',messageId:'65'};
    });

    await send({mode:'dm',text:'Повтор 2',clientMsgId:'k-7'});
    await send({mode:'dm',text:'Повтор 2',clientMsgId:'k-8'});

    const entries=readRecord(CHAT_LEAD).replies.filter(x=>x.text==='Повтор 2');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({status:'sent',ok:true,sendKey:'k-8'});
  });
});
