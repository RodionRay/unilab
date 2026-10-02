import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,OWNER,SETTINGS_ID,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {CHAT_LEAD,addChatLead,enableNotifications,readRecord,writeRecord,type WorkerCall} from './helpers/chats-fixture';
import {buttonsOf,stubWorkerAndBot} from './helpers/bot-fixture';
import {addMember,clearTmaState,linkTelegram,prepareTmaTables,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {POST as linkPOST} from '@/app/api/tma/link/route';
import {createLinkCode,findActiveLink,findActiveLinkForUser,redeemLinkCode} from '@/lib/tma/links';

const TG=900;
const NEUTRAL='Ссылка недействительна или устарела — получите новую в настройках UniLab';
const ONBOARDING='Это бот уведомлений UniLab. Чтобы подключиться, нажмите «Подключить Telegram» в настройках UniLab.';
const pollBot=async()=>(await POST(postRequest({action:'poll_bot_updates'}))).json() as Promise<Record<string,unknown>>;
const noWorker=(call:WorkerCall)=>{throw new Error(`unexpected worker call ${call.path}`)};
const privateMsg=(updateId:number,text:string,extra:Record<string,unknown>={},tg=TG)=>({
 update_id:updateId,
 message:{message_id:50+updateId,chat:{id:tg,type:'private'},from:{id:tg,is_bot:false,first_name:'Анна',username:'anna_tg'},date:1,text,...extra},
});
const db=()=>testDb().db;
/** A request that arrived on an attacker-chosen public https Host. */
const hostRequest=(body:Record<string,unknown>)=>new Request('https://evil.example/api/workspace',{
 method:'POST',
 headers:{'Content-Type':'application/json',origin:'https://evil.example'},
 body:JSON.stringify(body),
});

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(()=>{
 resetWorkspace();
 clearTmaState();
 login(OWNER);
 vi.stubEnv('APP_URL','https://app.test');
 vi.stubEnv('SESSION_SECRET','x'.repeat(48));
 vi.spyOn(console,'error').mockImplementation(()=>{});
 enableNotifications();
});
afterEach(()=>{
 vi.unstubAllGlobals();
 vi.unstubAllEnvs();
 vi.restoreAllMocks();
});

describe('бот · привязка Telegram в личке (REQ-L2)',()=>{
 it('/start link_<code> → привязка, меню чата = мини-апп, подтверждение',async()=>{
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(1,`/start link_${code}`)]);

  await pollBot();

  const link=await findActiveLink(db(),OWNER,TG);
  expect(link).toMatchObject({userId:OWNER,tgUsername:'anna_tg',botId:'123456'});
  const menu=w.botCalls.filter(c=>c.method==='setChatMenuButton');
  expect(menu).toHaveLength(1);
  expect(menu[0]?.body).toEqual({chat_id:TG,menu_button:{type:'web_app',text:'UniLab',web_app:{url:`https://app.test/tma/${await wsKeyOf()}`}}});
  const reply=w.sent();
  expect(reply).toHaveLength(1);
  expect(String(reply[0]?.body.chat_id)).toBe(String(TG));
  expect(String(reply[0]?.body.text)).toContain('Telegram подключён к UniLab — откройте приложение кнопкой меню');
 });

 it('тот же update дважды → обработан один раз (offset до действия)',async()=>{
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  const upd=privateMsg(2,`/start link_${code}`);
  w.queueUpdates([upd]);
  w.queueUpdates([upd]);

  await pollBot();
  await pollBot();

  expect(w.sent()).toHaveLength(1);
  expect(w.botCalls.filter(c=>c.method==='getUpdates')[1]?.body.offset).toBe(3);
 });

 it.each([
  ['просрочен',async()=>(await createLinkCode(db(),OWNER,OWNER,Date.now()-11*60_000)).code],
  ['использован',async()=>{
   const {code}=await createLinkCode(db(),OWNER,OWNER);
   await redeemLinkCode(db(),OWNER,code,{id:111,username:''},'123456');
   return code;
  }],
  ['чужой кабинет',async()=>(await createLinkCode(db(),'owner-2','owner-2')).code],
  ['мусор',async()=>'not-a-code'],
 ])('REQ-L5: код %s → нейтральный ответ, без меню и без привязки',async(_name,mint)=>{
  const code=await mint();
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(3,`/start link_${code}`)]);

  await pollBot();

  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton')).toHaveLength(0);
  expect(w.sent().map(c=>c.body.text)).toEqual([NEUTRAL]);
  expect(buttonsOf(w.sent()[0])).toEqual([]);
  expect(await findActiveLink(db(),OWNER,TG)).toBeNull();
 });

 it('L3: tg уже привязан к другому сотруднику → нейтральный отказ «сначала отключите», старая привязка цела',async()=>{
  addMember('manager-1','manager');
  await linkTelegram('manager-1',TG);
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(9,`/start link_${code}`)]);

  await pollBot();

  expect((await findActiveLink(db(),OWNER,TG))?.userId).toBe('manager-1');
  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton')).toHaveLength(0);
  const text=String(w.sent()[0]?.body.text);
  expect(text).toContain('уже подключён');
  expect(text).toContain('Отключить');
  expect(text).not.toContain('manager-1');
 });

 it('setChatMenuButton не удался → ответ не отсылает к кнопке меню, а даёт кнопку «Открыть UniLab» (web_app)',async()=>{
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker,(call)=>call.method==='setChatMenuButton'?{ok:false,description:'Bad Request: chat not found'}:undefined);
  w.queueUpdates([privateMsg(10,`/start link_${code}`)]);

  await pollBot();

  expect(await findActiveLink(db(),OWNER,TG)).not.toBeNull();
  const reply=w.sent()[0];
  expect(String(reply?.body.text)).not.toContain('кнопкой меню');
  expect(buttonsOf(reply)).toEqual([{text:'Открыть UniLab',web_app:{url:`https://app.test/tma/${await wsKeyOf()}`}}]);
 });

 it('адрес кабинета не публичный https → привязка есть, меню не ставится, ответ про https',async()=>{
  vi.stubEnv('APP_URL','http://localhost:5180');
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(4,`/start link_${code}`)]);

  await pollBot();

  expect(await findActiveLink(db(),OWNER,TG)).not.toBeNull();
  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton')).toHaveLength(0);
  expect(String(w.sent()[0]?.body.text)).toContain('https');
  expect(buttonsOf(w.sent()[0])).toEqual([]);
 });

 it('APP_URL не задан, запрос пришёл на публичный https Host → меню не ставится (адрес не из Host)',async()=>{
  vi.stubEnv('APP_URL','');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL','');
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(7,`/start link_${code}`),privateMsg(8,'/start')]);

  await POST(hostRequest({action:'poll_bot_updates'}));

  expect(await findActiveLink(db(),OWNER,TG)).not.toBeNull();
  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton')).toHaveLength(0);
  expect(w.sent()).toHaveLength(2);
  expect(w.sent().flatMap(c=>buttonsOf(c))).toEqual([]);
 });

 it('нет чата уведомлений, но есть ожидающий код → бот опрашивается и привязывает',async()=>{
  writeRecord(SETTINGS_ID,{...readRecord(SETTINGS_ID),notifyEnabled:false,notifyChatId:''});
  const {code}=await createLinkCode(db(),OWNER,OWNER);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(5,`/start link_${code}`)]);

  await pollBot();

  expect(await findActiveLink(db(),OWNER,TG)).not.toBeNull();
 });

 it('нет чата уведомлений, нет кодов и привязок → getUpdates не вызывается',async()=>{
  writeRecord(SETTINGS_ID,{...readRecord(SETTINGS_ID),notifyEnabled:false,notifyChatId:''});
  const w=stubWorkerAndBot(noWorker);

  const out=await pollBot();

  expect(out).toMatchObject({skipped:true});
  expect(w.botCalls).toHaveLength(0);
 });

 it('без чата уведомлений сообщения группы не обрабатываются',async()=>{
  writeRecord(SETTINGS_ID,{...readRecord(SETTINGS_ID),notifyEnabled:false});
  await linkTelegram(OWNER,TG);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([{update_id:6,message:{message_id:1,chat:{id:42,type:'supergroup'},from:{id:7,is_bot:false},date:1,text:'/start'}}]);

  await pollBot();

  expect(w.sent()).toHaveLength(0);
 });
});

describe('бот · прочая личка',()=>{
 it('не привязанный пользователь → только онбординг',async()=>{
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(10,'/start'),privateMsg(11,'покажи лиды',{},901)]);

  await pollBot();

  expect(w.sent().map(c=>c.body.text)).toEqual([ONBOARDING,ONBOARDING]);
  expect(w.sent().flatMap(c=>buttonsOf(c))).toEqual([]);
  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton')).toHaveLength(0);
 });

 it('привязанный /start → краткая справка с web_app «Открыть UniLab»',async()=>{
  await linkTelegram(OWNER,TG);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([privateMsg(12,'/start')]);

  await pollBot();

  expect(buttonsOf(w.sent()[0])).toEqual([{text:'Открыть UniLab',web_app:{url:`https://app.test/tma/${await wsKeyOf()}`}}]);
 });

 it('ответ в личке (Reply на уведомление) клиенту не уходит — подсказка про приложение',async()=>{
  addChatLead();
  await linkTelegram(OWNER,TG);
  const w=stubWorkerAndBot(noWorker);
  w.queueUpdates([
   privateMsg(13,'Ловите прайс',{reply_to_message:{message_id:5001,from:{id:1,is_bot:true}}}),
   {update_id:14,callback_query:{id:'cb',from:{id:TG,is_bot:false},data:`r:${CHAT_LEAD}`,message:{message_id:5001,chat:{id:TG,type:'private'}}}},
  ]);

  const out=await pollBot();

  expect(out).toMatchObject({ok:true,sent:0});
  expect(w.calls).toHaveLength(0);
  expect(w.sent().map(c=>c.body.text)).toEqual(['Ответьте клиенту в приложении — кнопка «Открыть»']);
  const answer=w.botCalls.find(c=>c.method==='answerCallbackQuery');
  expect(answer?.body).toMatchObject({callback_query_id:'cb',text:'Ответьте клиенту в приложении — кнопка «Открыть»'});
  expect(readRecord(CHAT_LEAD).replies).toHaveLength(1);
 });
});

describe('отключение (REQ-L4)',()=>{
 const unlink=async()=>linkPOST(new Request('http://crm.test/api/tma/link',{
  method:'POST',headers:{'Content-Type':'application/json',origin:'http://crm.test'},body:JSON.stringify({action:'unlink'}),
 }));

 it('unlink сбрасывает меню чата на default',async()=>{
  await linkTelegram(OWNER,TG);
  const w=stubWorkerAndBot(noWorker);

  const res=await unlink();

  expect(res.status).toBe(200);
  expect(w.botCalls.filter(c=>c.method==='setChatMenuButton').map(c=>c.body)).toEqual([{chat_id:TG,menu_button:{type:'default'}}]);
  expect(JSON.stringify(await res.json())).not.toContain(BOT_TOKEN);
 });

 it('ошибка Bot API при сбросе меню не мешает отключению',async()=>{
  await linkTelegram(OWNER,TG);
  stubWorkerAndBot(noWorker,()=>{throw new Error('network down')});

  const res=await unlink();

  expect(res.status).toBe(200);
  expect(await findActiveLinkForUser(db(),OWNER,OWNER)).toBeNull();
 });
});
