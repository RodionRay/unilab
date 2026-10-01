import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,OWNER,SETTINGS_ID,login,postRequest,resetWorkspace} from './helpers/workspace-harness';
import {ACC_A,ACC_B,API_ID,CHAT_LEAD,GROUP_ID,addChatLead,addSealedAccount,dropHarnessAccount,enableNotifications,readRecord,type WorkerCall} from './helpers/chats-fixture';
import {buttonsOf,stubWorkerAndBot} from './helpers/bot-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';

const NOW_TS=Math.floor(Date.now()/1000);
const poll=()=>POST(postRequest({action:'poll_dm_replies'}));
const send=(text:string)=>POST(postRequest({action:'send_lead_message',id:CHAT_LEAD,mode:'dm',text}));
const clientMsg=(messageId:string,text='Да, интересно')=>({
  userId:'777',username:'client_nick',name:'Клиент',text,messageId,
  at:new Date(NOW_TS*1000).toISOString(),ts:NOW_TS,hasMedia:false,
});
/** Worker: ACC_A inbox has one client message, other inboxes are empty, /send-message succeeds. */
const worker=(text='Да, интересно')=>(call:WorkerCall)=>{
  if(call.path==='/send-message')return {ok:true,chatId:'777',messageId:'77'};
  const messages=call.body.apiId===API_ID[ACC_A]?[clientMsg('900',text)]:[];
  return {ok:true,messages,complete:true,scanStartedTs:NOW_TS};
};
const rescanLog=()=>JSON.stringify((readRecord(SETTINGS_ID) as Record<string,unknown>).rescanLog||[]);

describe('Telegram-бот · уведомления о переписке',()=>{
  beforeEach(async()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    vi.stubEnv('APP_URL','https://app.test');
    vi.spyOn(console,'error').mockImplementation(()=>{});
    dropHarnessAccount();
    await addSealedAccount(ACC_A,{name:'Ферма Анна'});
    await addSealedAccount(ACC_B,{});
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('REQ-2: poll_dm_replies отвечает только после того, как бот доставил уведомление (workerd режет висящий fetch)',async()=>{
    addChatLead();
    enableNotifications();
    let delivered=false;
    stubWorkerAndBot(worker(),async(call)=>{
      if(call.method!=='sendMessage')return undefined;
      await new Promise(r=>setTimeout(r,40));
      delivered=true;
      return undefined;
    });

    await poll();

    expect(delivered).toBe(true);
  });

  it('REQ-2: ошибка Bot API попадает в журнал кабинета без токена',async()=>{
    addChatLead();
    enableNotifications();
    stubWorkerAndBot(worker(),(call)=>{
      if(call.method==='sendMessage')throw new Error(`connect ETIMEDOUT ${call.url}`);
      return undefined;
    });

    await poll();

    expect(rescanLog()).toContain('ETIMEDOUT');
    expect(rescanLog()).not.toContain(BOT_TOKEN);
  });

  it('REQ-2: «chat not found» от Telegram объясняет, что делать (нажать /start в боте)',async()=>{
    addChatLead();
    enableNotifications();
    stubWorkerAndBot(worker(),(call)=>call.method==='sendMessage'
      ?new Response(JSON.stringify({ok:false,error_code:400,description:'Bad Request: chat not found'}),{status:400})
      :undefined);

    await poll();

    expect(rescanLog()).toContain('chat not found');
    expect(rescanLog()).toContain('/start');
  });

  it('REQ-3: ответ клиента — HTML с экранированием, источник, аккаунт, цитата и кнопки',async()=>{
    addChatLead({name:'Иван <b>&</b>'});
    enableNotifications();
    const {sent}=stubWorkerAndBot(worker('Цена? <script>alert(1)</script> & скидка'));

    await poll();

    const msg=sent()[0];
    expect(msg?.body.parse_mode).toBe('HTML');
    expect(msg?.body.chat_id).toBe('42');
    const text=String(msg?.body.text);
    expect(text).toContain('Иван &lt;b&gt;&amp;&lt;/b&gt;');
    expect(text).toContain('<blockquote>Цена? &lt;script&gt;alert(1)&lt;/script&gt; &amp; скидка</blockquote>');
    expect(text).toContain('Продавцы WB');
    expect(text).toContain('Ферма Анна');
    expect(text).not.toContain('<script>');
    expect(buttonsOf(msg)).toEqual(expect.arrayContaining([
      {text:'Открыть чат',url:`https://app.test/app?view=chats&lead=${CHAT_LEAD}`},
      {text:'Написать в Telegram',url:'https://t.me/client_nick'},
      {text:'Ответить',callback_data:`r:${CHAT_LEAD}`},
    ]));
  });

  it('REQ-3: localhost-адрес кабинета не ставится в кнопку (Telegram её отвергнет) — ссылка в тексте',async()=>{
    vi.stubEnv('APP_URL','http://localhost:5180');
    addChatLead();
    enableNotifications();
    const {sent}=stubWorkerAndBot(worker());

    await poll();

    const msg=sent()[0];
    expect(buttonsOf(msg).some(b=>b.text==='Открыть чат')).toBe(false);
    expect(String(msg?.body.text)).toContain(`http://localhost:5180/app?view=chats&amp;lead=${CHAT_LEAD}`);
  });

  it('REQ-3: клиент без username — кнопки «Написать в Telegram» нет, ссылка tg://user в тексте',async()=>{
    addChatLead({senderUsername:''});
    enableNotifications();
    const {sent}=stubWorkerAndBot((call)=>{
      if(call.path==='/send-message')return {ok:true};
      const messages=call.body.apiId===API_ID[ACC_A]?[{...clientMsg('901'),username:''}]:[];
      return {ok:true,messages,complete:true,scanStartedTs:NOW_TS};
    });

    await poll();

    const msg=sent()[0];
    expect(buttonsOf(msg).some(b=>b.text==='Написать в Telegram')).toBe(false);
    expect(String(msg?.body.text)).toContain('href="tg://user?id=777"');
  });

  it('REQ-3: если Telegram отверг разметку — уходит простой текст без parse_mode',async()=>{
    addChatLead();
    enableNotifications();
    let first=true;
    const {sent}=stubWorkerAndBot(worker(),(call)=>{
      if(call.method!=='sendMessage'||!first)return undefined;
      first=false;
      return new Response(JSON.stringify({ok:false,error_code:400,description:"Bad Request: can't parse entities"}),{status:400});
    });

    await poll();

    expect(sent()).toHaveLength(2);
    expect(sent()[1]?.body.parse_mode).toBeUndefined();
    expect(String(sent()[1]?.body.text)).toContain('Да, интересно');
    expect(rescanLog()).not.toContain("can't parse");
  });

  it('REQ-1/REQ-3: первое наше сообщение открывает переписку и шлёт одно уведомление «Начата переписка»',async()=>{
    addChatLead({conversationOpen:false,needsManager:false,replies:[]});
    enableNotifications();
    const {sent}=stubWorkerAndBot(worker());

    const res=await send('Здравствуйте! Подскажу по остаткам');
    expect(res.status).toBe(200);
    const lead=readRecord(CHAT_LEAD);
    expect(lead.conversationOpen).toBe(true);
    expect(Date.parse(String(lead.conversationAt))).toBeGreaterThan(Date.now()-60_000);
    expect(sent()).toHaveLength(1);
    expect(String(sent()[0]?.body.text)).toContain('Начата переписка');
    expect(String(sent()[0]?.body.text)).toContain('Здравствуйте! Подскажу по остаткам');

    await send('Второе сообщение');
    expect(sent()).toHaveLength(1);
  });

  it('REQ-2: уведомления выключены — бот не вызывается',async()=>{
    addChatLead({conversationOpen:false,replies:[]});
    const {botCalls}=stubWorkerAndBot(worker());

    await send('Привет');
    await poll();

    expect(botCalls).toHaveLength(0);
  });

  it('REQ-1: группа лида попадает в источник уведомления о первом контакте',async()=>{
    addChatLead({conversationOpen:false,replies:[],groupId:GROUP_ID});
    enableNotifications();
    const {sent}=stubWorkerAndBot(worker());

    await send('Привет');

    expect(String(sent()[0]?.body.text)).toContain('Продавцы WB');
  });
});
