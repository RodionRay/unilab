import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,OWNER,login,postRequest,resetWorkspace} from './helpers/workspace-harness';
import {ACC_A,ACC_B,API_ID,CHAT_LEAD,addChatLead,addSealedAccount,dropHarnessAccount,enableNotifications,readRecord,type WorkerCall} from './helpers/chats-fixture';
import {stubWorkerAndBot} from './helpers/bot-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const NOW_TS=Math.floor(Date.now()/1000);
const pollDms=()=>POST(postRequest({action:'poll_dm_replies'}));
const pollBot=async()=>(await POST(postRequest({action:'poll_bot_updates'}))).json() as Promise<Record<string,unknown>>;
const OWNER_CHAT=42;
type Sends={calls:WorkerCall[]};
const clientSends=(w:Sends)=>w.calls.filter(c=>c.path==='/send-message');

const worker=(sendOk=true)=>(call:WorkerCall)=>{
  if(call.path==='/send-message')return sendOk?{ok:true,chatId:'777',messageId:'78'}:{ok:false,error:'USER_PRIVACY_RESTRICTED'};
  const messages=call.body.apiId===API_ID[ACC_A]
    ?[{userId:'777',username:'client_nick',name:'Клиент',text:'Сколько стоит?',messageId:'900',at:new Date(NOW_TS*1000).toISOString(),ts:NOW_TS,hasMedia:false}]
    :[];
  return {ok:true,messages,complete:true,scanStartedTs:NOW_TS};
};

const managerReply=(updateId:number,replyTo:number,text:string,chatId=OWNER_CHAT)=>({
  update_id:updateId,
  message:{message_id:300+updateId,chat:{id:chatId,type:'private'},from:{id:chatId,is_bot:false,first_name:'M'},date:NOW_TS,text,reply_to_message:{message_id:replyTo}},
});

describe('Telegram-бот · ответ клиенту из бота (poll_bot_updates)',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('APP_URL','https://app.test');
    vi.spyOn(console,'error').mockImplementation(()=>{});
    dropHarnessAccount();
    await addSealedAccount(ACC_A,{});
    await addSealedAccount(ACC_B,{});
    addChatLead();
    enableNotifications();
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Client wrote → bot notification (message_id returned by the stub) → manager answers it. */
  async function notified(w:ReturnType<typeof stubWorkerAndBot>){
    await pollDms();
    const res=w.botCalls.find(c=>c.method==='sendMessage');
    expect(res).toBeTruthy();
    return 5001;
  }

  it('REQ-4: ответ (reply) на уведомление уходит клиенту тем же аккаунтом, бот подтверждает',async()=>{
    const w=stubWorkerAndBot(worker());
    const notice=await notified(w);
    w.queueUpdates([managerReply(100,notice,'Ловите прайс')]);

    const out=await pollBot();

    expect(out).toMatchObject({ok:true,sent:1});
    const sends=clientSends(w);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toMatchObject({text:'Ловите прайс',mode:'dm',apiId:API_ID[ACC_A],senderUsername:'client_nick'});
    const lead=readRecord(CHAT_LEAD);
    expect(lead.replies.at(-1)).toMatchObject({from:'us',text:'Ловите прайс',ok:true,status:'sent',accountId:ACC_A});
    const confirm=w.sent().at(-1);
    expect(String(confirm?.body.text)).toContain('Отправлено');
    expect(confirm?.body.reply_parameters?.message_id).toBe(400);
  });

  it('REQ-4: getUpdates идёт с offset; повтор того же update_id не шлёт клиенту дубль',async()=>{
    const w=stubWorkerAndBot(worker());
    const notice=await notified(w);
    const upd=managerReply(101,notice,'Один раз');
    w.queueUpdates([upd]);
    w.queueUpdates([upd]);

    await pollBot();
    await pollBot();

    expect(clientSends(w)).toHaveLength(1);
    const gets=w.botCalls.filter(c=>c.method==='getUpdates');
    expect(gets[1]?.body.offset).toBe(102);
  });

  it('REQ-4 authz: сообщение из чужого чата игнорируется, offset всё равно двигается',async()=>{
    const w=stubWorkerAndBot(worker());
    const notice=await notified(w);
    w.queueUpdates([managerReply(102,notice,'Я чужой',999)]);

    await pollBot();
    await pollBot();

    expect(clientSends(w)).toHaveLength(0);
    expect(w.sent().filter(c=>String(c.body.chat_id)==='999')).toHaveLength(0);
    expect(w.botCalls.filter(c=>c.method==='getUpdates')[1]?.body.offset).toBe(103);
  });

  it('REQ-4: кнопка «Ответить» → force_reply-подсказка; ответ на неё уходит клиенту',async()=>{
    const w=stubWorkerAndBot(worker());
    await notified(w);
    w.queueUpdates([{update_id:103,callback_query:{id:'cb1',from:{id:OWNER_CHAT,is_bot:false},data:`r:${CHAT_LEAD}`,message:{message_id:5001,chat:{id:OWNER_CHAT,type:'private'}}}}]);

    await pollBot();

    expect(w.botCalls.some(c=>c.method==='answerCallbackQuery'&&c.body.callback_query_id==='cb1')).toBe(true);
    const prompt=w.sent().at(-1);
    expect(prompt?.body.reply_markup?.force_reply).toBe(true);
    expect(String(prompt?.body.text)).toContain('Клиент');

    w.queueUpdates([managerReply(104,5002,'Ответ через кнопку')]);
    await pollBot();

    expect(clientSends(w).map(c=>c.body.text)).toEqual(['Ответ через кнопку']);
  });

  it('REQ-4 authz: «Ответить» по чужому/несуществующему лиду не создаёт подсказку',async()=>{
    const w=stubWorkerAndBot(worker());
    w.queueUpdates([{update_id:105,callback_query:{id:'cb2',from:{id:OWNER_CHAT,is_bot:false},data:'r:ffffffff-ffff-4fff-8fff-ffffffffffff',message:{message_id:1,chat:{id:OWNER_CHAT,type:'private'}}}}]);

    await pollBot();

    const answer=w.botCalls.find(c=>c.method==='answerCallbackQuery');
    expect(String(answer?.body.text)).toContain('не найден');
    expect(w.sent()).toHaveLength(0);
  });

  it('REQ-4: ошибка отправки клиенту — понятное сообщение в боте',async()=>{
    const w=stubWorkerAndBot(worker(false));
    const notice=await notified(w);
    w.queueUpdates([managerReply(106,notice,'Не дойдёт')]);

    const out=await pollBot();

    expect(out).toMatchObject({ok:true,sent:0});
    const last=String(w.sent().at(-1)?.body.text);
    expect(last).toContain('Не отправлено');
    expect(last).toContain('USER_PRIVACY_RESTRICTED');
  });

  it('REQ-4: ответ не на уведомление — подсказка, клиенту ничего не уходит',async()=>{
    const w=stubWorkerAndBot(worker());
    w.queueUpdates([{update_id:107,message:{message_id:9,chat:{id:OWNER_CHAT,type:'private'},from:{id:OWNER_CHAT,is_bot:false},date:NOW_TS,text:'просто текст'}}]);

    await pollBot();

    expect(clientSends(w)).toHaveLength(0);
    expect(String(w.sent().at(-1)?.body.text)).toContain('Ответить');
  });

  it('REQ-4: /start — бот отвечает инструкцией',async()=>{
    const w=stubWorkerAndBot(worker());
    w.queueUpdates([{update_id:108,message:{message_id:10,chat:{id:OWNER_CHAT,type:'private'},from:{id:OWNER_CHAT,is_bot:false},date:NOW_TS,text:'/start'}}]);

    await pollBot();

    expect(String(w.sent().at(-1)?.body.text)).toContain('уведомления');
    expect(clientSends(w)).toHaveLength(0);
  });

  it('REQ-4: уведомления выключены — getUpdates не вызывается',async()=>{
    const w=stubWorkerAndBot(worker());
    resetWorkspace();
    login(OWNER);

    const out=await pollBot();

    expect(out).toMatchObject({ok:true,skipped:true});
    expect(w.botCalls).toHaveLength(0);
  });

  it('REQ-4: за один опрос — не больше одной отправки клиенту, следующий update ждёт следующего опроса',async()=>{
    const w=stubWorkerAndBot(worker());
    const notice=await notified(w);
    w.queueUpdates([managerReply(110,notice,'Первое'),managerReply(111,notice,'Второе')]);
    w.queueUpdates([managerReply(111,notice,'Второе')]);

    await pollBot();
    expect(clientSends(w).map(c=>c.body.text)).toEqual(['Первое']);
    await pollBot();

    expect(clientSends(w).map(c=>c.body.text)).toEqual(['Первое','Второе']);
    expect(w.botCalls.filter(c=>c.method==='getUpdates')[1]?.body.offset).toBe(111);
  });

  it('REQ-4: параллельный опрос бота того же владельца пропускается (lease), getUpdates один',async()=>{
    let release:()=>void=()=>{};
    const gate=new Promise<void>(r=>{release=r});
    const w=stubWorkerAndBot(worker(),async(call)=>{
      if(call.method==='getUpdates'){await gate;return {ok:true,result:[]}}
      return undefined;
    });

    const first=pollBot();
    await vi.waitFor(()=>expect(w.botCalls.length).toBe(1));
    const second=await pollBot();
    release();
    await first;

    expect(second).toMatchObject({skipped:true,reason:'busy'});
    expect(w.botCalls.filter(c=>c.method==='getUpdates')).toHaveLength(1);
  });

  it('REQ-4: токен бота не утекает в ответ API при сетевой ошибке getUpdates',async()=>{
    const w=stubWorkerAndBot(worker(),(call)=>{
      if(call.method==='getUpdates')throw new Error(`fetch failed ${call.url}`);
      return undefined;
    });

    const out=await pollBot();

    expect(JSON.stringify(out)).not.toContain(BOT_TOKEN);
    expect(w.botCalls.filter(c=>c.method==='getUpdates')).toHaveLength(1);
  });

  describe('уведомления в группе команды (бот — админ и видит всё)',()=>{
    const BOT={id:1,is_bot:true,first_name:'UniLabs'};
    const PERSON={id:7,is_bot:false,first_name:'Rodion'};
    const groupMsg=(updateId:number,extra:Record<string,unknown>)=>({
      update_id:updateId,
      message:{message_id:600+updateId,chat:{id:OWNER_CHAT,type:'supergroup'},from:PERSON,date:NOW_TS,...extra},
    });

    it('обычная переписка сотрудников, Reply друг другу и служебные события — бот молчит',async()=>{
      const w=stubWorkerAndBot(worker());
      w.queueUpdates([
        groupMsg(120,{text:'ебать копать'}),
        groupMsg(121,{text:'Ага',reply_to_message:{message_id:5,from:PERSON,text:'привет'}}),
        groupMsg(122,{new_chat_members:[{id:9,is_bot:false,first_name:'Иван'}]}),
      ]);

      const out=await pollBot();

      expect(out).toMatchObject({ok:true,handled:3,sent:0});
      expect(w.sent()).toHaveLength(0);
      expect(clientSends(w)).toHaveLength(0);
    });

    it('Reply на подсказку бота (не уведомление) — бот молчит, без подсказки по кругу',async()=>{
      const w=stubWorkerAndBot(worker());
      w.queueUpdates([groupMsg(123,{text:'ага',reply_to_message:{message_id:77,from:BOT,text:'Не понял, какому клиенту ответ.'}})]);

      await pollBot();

      expect(w.sent()).toHaveLength(0);
      expect(clientSends(w)).toHaveLength(0);
    });

    it('Reply на уведомление старого формата — одно понятное объяснение, клиенту ничего не уходит',async()=>{
      const w=stubWorkerAndBot(worker());
      w.queueUpdates([groupMsg(124,{text:'понял',reply_to_message:{message_id:78,from:BOT,text:'UniLab · переписка\nКлиент ответил: @rodion4ek\nпонял'}})]);

      await pollBot();

      expect(clientSends(w)).toHaveLength(0);
      expect(w.sent()).toHaveLength(1);
      expect(String(w.sent()[0]?.body.text)).toContain('старого формата');
    });

    it('Reply на уведомление о клиенте в группе уходит клиенту',async()=>{
      const w=stubWorkerAndBot(worker());
      const notice=await notified(w);
      w.queueUpdates([groupMsg(125,{text:'Ловите прайс',reply_to_message:{message_id:notice,from:BOT}})]);

      const out=await pollBot();

      expect(out).toMatchObject({sent:1});
      expect(clientSends(w).map(c=>c.body.text)).toEqual(['Ловите прайс']);
    });
  });
});
