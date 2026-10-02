import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,OWNER,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {ACC_A,ACC_B,API_ID,CHAT_LEAD,addChatLead,addSealedAccount,dropHarnessAccount,enableNotifications,type WorkerCall} from './helpers/chats-fixture';
import {buttonsOf,stubWorkerAndBot,type BotCall} from './helpers/bot-fixture';
import {addMember,clearTmaState,linkTelegram,prepareTmaTables,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {findActiveLinkForUser,setDmNotices} from '@/lib/tma/links';
import {DM_CONCURRENCY,sendDmNotices} from '@/lib/tma/bot-link';

const NOW_TS=Math.floor(Date.now()/1000);
const TG=901;
const db=()=>testDb().db;
const pollDms=()=>POST(postRequest({action:'poll_dm_replies'}));
/** ACC_A inbox has one client message → one client_reply notice. */
const worker=(call:WorkerCall)=>{
 if(call.path==='/send-message')return {ok:true,chatId:'777',messageId:'77'};
 const messages=call.body.apiId===API_ID[ACC_A]
  ?[{userId:'777',username:'client_nick',name:'Клиент',text:'Сколько стоит?',messageId:'900',at:new Date(NOW_TS*1000).toISOString(),ts:NOW_TS,hasMedia:false}]
  :[];
 return {ok:true,messages,complete:true,scanStartedTs:NOW_TS};
};
const toChat=(calls:BotCall[],chat:string|number)=>calls.filter(c=>String(c.body.chat_id)===String(chat));

async function optIn(userId:string,tgId:number){
 await linkTelegram(userId,tgId);
 await setDmNotices(db(),OWNER,userId,true);
}

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(async()=>{
 resetWorkspace();
 clearTmaState();
 login(OWNER);
 vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
 vi.stubEnv('APP_URL','https://app.test');
 vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 dropHarnessAccount();
 await addSealedAccount(ACC_A,{name:'Ферма Анна'});
 await addSealedAccount(ACC_B,{});
 addChatLead();
 enableNotifications();
});
afterEach(()=>{
 vi.unstubAllGlobals();
 vi.unstubAllEnvs();
 vi.restoreAllMocks();
});

describe('личные уведомления о переписке (REQ-N1)',()=>{
 it('подписанному участнику — те же факты и одна кнопка web_app ?lead=<id>; группа без изменений',async()=>{
  await optIn(OWNER,TG);
  const w=stubWorkerAndBot(worker);

  await pollDms();

  const group=toChat(w.sent(),42);
  expect(group).toHaveLength(1);
  expect(buttonsOf(group[0]).some(b=>b.callback_data===`r:${CHAT_LEAD}`)).toBe(true);
  const dm=toChat(w.sent(),TG);
  expect(dm).toHaveLength(1);
  expect(String(dm[0]?.body.text)).toContain('Сколько стоит?');
  expect(buttonsOf(dm[0])).toEqual([{text:'Открыть',web_app:{url:`https://app.test/tma/${await wsKeyOf()}?lead=${CHAT_LEAD}`}}]);
 });

 it('не подписан или нет доступа к лидам → ЛС нет',async()=>{
  await linkTelegram(OWNER,TG);
  addMember('viewer-1','viewer',OWNER,{overview:true,notifications:false,leads:false,chats:false,groups:false,audience:false,invite:false,mailing:false,accounts:false,proxies:false,ai:false,settings:false,staff:false});
  await optIn('viewer-1',902);
  const w=stubWorkerAndBot(worker);

  await pollDms();

  expect(toChat(w.sent(),TG)).toHaveLength(0);
  expect(toChat(w.sent(),902)).toHaveLength(0);
  expect(toChat(w.sent(),42)).toHaveLength(1);
 });

 it('адрес кабинета не https → ЛС не шлются, группа шлётся',async()=>{
  vi.stubEnv('APP_URL','http://localhost:5180');
  await optIn(OWNER,TG);
  const w=stubWorkerAndBot(worker);

  await pollDms();

  expect(toChat(w.sent(),TG)).toHaveLength(0);
  expect(toChat(w.sent(),42)).toHaveLength(1);
 });

 it('REQ-N2: 403 «bot was blocked» → ЛС выключены, ошибка сохранена; уведомление в группу ушло',async()=>{
  await optIn(OWNER,TG);
  const w=stubWorkerAndBot(worker,(call)=>{
   if(call.method==='sendMessage'&&String(call.body.chat_id)===String(TG)){
    return Response.json({ok:false,description:'Forbidden: bot was blocked by the user'},{status:403});
   }
   return undefined;
  });

  await pollDms();

  const link=await findActiveLinkForUser(db(),OWNER,OWNER);
  expect(link?.dmNotices).toBe(false);
  expect(link?.dmError).toContain('bot was blocked');
  expect(link?.dmError).not.toContain(BOT_TOKEN);
  expect(toChat(w.sent(),42)).toHaveLength(1);
 });

 it('сбой ЛС до отправки в группу не мешает: группа шлётся первой',async()=>{
  await optIn(OWNER,TG);
  const order:string[]=[];
  stubWorkerAndBot(worker,(call)=>{
   if(call.method==='sendMessage')order.push(String(call.body.chat_id));
   if(call.method==='sendMessage'&&String(call.body.chat_id)===String(TG))throw new Error('ETIMEDOUT');
   return undefined;
  });

  const res=await pollDms();

  expect(res.status).toBe(200);
  expect(order[0]).toBe('42');
 });
});

describe('sendDmNotices · ограничения',()=>{
 it(`параллельно не больше ${5} отправок`,async()=>{
  const ids=Array.from({length:12},(_,i)=>`member-${i}`);
  for(const [i,id] of ids.entries()){
   addMember(id,'manager');
   await optIn(id,1000+i);
  }
  let inFlight=0;
  let peak=0;
  const w=stubWorkerAndBot(worker,async(call)=>{
   if(call.method!=='sendMessage')return undefined;
   inFlight++;
   peak=Math.max(peak,inFlight);
   await new Promise(r=>setTimeout(r,10));
   inFlight--;
   return undefined;
  });

  await sendDmNotices(db(),OWNER,BOT_TOKEN,'https://app.test',[{leadId:CHAT_LEAD,html:'<b>x</b>',plain:'x'}]);

  expect(DM_CONCURRENCY).toBe(5);
  expect(w.sent()).toHaveLength(12);
  expect(peak).toBeLessThanOrEqual(5);
  expect(peak).toBeGreaterThan(1);
 });

 it('без подписчиков — ни одного вызова Bot API',async()=>{
  const w=stubWorkerAndBot(worker);

  await sendDmNotices(db(),OWNER,BOT_TOKEN,'https://app.test',[{leadId:CHAT_LEAD,html:'x',plain:'x'}]);

  expect(w.botCalls).toHaveLength(0);
 });
});
