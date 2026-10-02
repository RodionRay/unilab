import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,BOT_TOKEN,OWNER,SETTINGS_ID,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {clearTmaState,linkTelegram,prepareTmaTables,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {setDmNotices} from '@/lib/tma/links';

const GROUP_ID='99999999-9999-4999-8999-999999999999';
const TG=901;
type TgCall={chat:string;text:string;markup:unknown};
const tg:TgCall[]=[];
let temperature='hot';
let groupFailures=0;

function installFetch(messages:string[]){
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const u=String(url);
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(u.includes('/scan-group')){
   const now=new Date().toISOString();
   return Response.json({ok:true,title:'Sellers',cursor:'',fetched:messages.length,
    messages:messages.map((m,i)=>({tgMsgId:String(100+i),message:m,name:'Иван',date:now,senderId:'700',senderUsername:'ivan'}))});
  }
  if(u.includes('/chat/completions')){
   const ids=[...String(body.messages?.[1]?.content||'').matchAll(/id=(\S+)/g)].map(m=>m[1]!);
   return Response.json({choices:[{message:{content:JSON.stringify(ids.map(id=>({id,reason:'ok',temperature})))}}]});
  }
  if(u.includes('api.telegram.org')){
   if(String(body.chat_id)==='42'&&groupFailures>0){
    groupFailures--;
    return Response.json({ok:false,description:'Bad Gateway'},{status:502});
   }
   tg.push({chat:String(body.chat_id),text:String(body.text||''),markup:body.reply_markup});
   return Response.json({ok:true,result:{message_id:tg.length}});
  }
  throw new Error(`unexpected fetch ${u}`);
 }));
}

const leadIds=()=>(testDb().sqlite.prepare("SELECT id FROM records WHERE kind='lead' AND json_extract(data,'$.groupId')=? ORDER BY created").all(GROUP_ID) as {id:string}[]).map(r=>r.id);

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(async()=>{
 resetWorkspace();
 clearTmaState();
 login(OWNER);
 tg.length=0;
 temperature='hot';
 groupFailures=0;
 vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
 vi.stubEnv('AI_API_KEY','sk-test-not-real');
 vi.stubEnv('APP_URL','https://app.test');
 const {sqlite}=testDb();
 sqlite.prepare("DELETE FROM records WHERE kind='lead'").run();
 sqlite.prepare('UPDATE records SET secret=? WHERE id=?').run(await seal(JSON.stringify({kind:'tdata',zipBase64:'eA==',apiId:1,apiHash:'h'}),OWNER),ACCOUNT_ID);
 addRecord(GROUP_ID,'group',{name:'Sellers',url:'https://t.me/sellers_chat',accountId:ACCOUNT_ID,status:'active',membership:'joined'});
 sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({
  name:'Проект',keywords:'остатки, синхронизация, МойСклад',minusKeywords:'',avoidTopics:'',
  leadCriteria:'Ищет сервис для синхронизации остатков',hotSignals:'ищу сервис',product:'Платформа для селлеров',
  aiQualify:true,notifyEnabled:true,notifyBotToken:BOT_TOKEN,notifyChatId:'42',
 }),SETTINGS_ID);
 await linkTelegram(OWNER,TG);
 await setDmNotices(testDb().db,OWNER,OWNER,true);
});
afterEach(()=>{
 vi.unstubAllGlobals();
 vi.unstubAllEnvs();
});

const scan=()=>POST(postRequest({action:'scan_group',id:GROUP_ID,force:true}));
const targets=(n:number)=>Array.from({length:n},(_,i)=>`Ищу сервис для синхронизации остатков WB и МойСклад, магазин номер ${i}`);

describe('личные уведомления о горячих лидах (REQ-N1)',()=>{
 it('горячий лид → группа как раньше + ЛС с кнопкой web_app ?lead=<id>',async()=>{
  installFetch(targets(1));

  await scan();

  const [leadId]=leadIds();
  expect(tg.filter(c=>c.chat==='42')).toHaveLength(1);
  expect(tg.find(c=>c.chat==='42')?.text).toContain('UniLab · новые лиды (1)');
  const dm=tg.filter(c=>c.chat===String(TG));
  expect(dm).toHaveLength(1);
  expect(dm[0]?.text).toContain('Горячий лид');
  expect(dm[0]?.markup).toEqual({inline_keyboard:[[{text:'Открыть',web_app:{url:`https://app.test/tma/${await wsKeyOf()}?lead=${leadId}`}}]]});
 });

 it('не больше 3 ЛС за один скан',async()=>{
  installFetch(targets(5));

  await scan();

  expect(leadIds()).toHaveLength(5);
  expect(tg.filter(c=>c.chat===String(TG))).toHaveLength(3);
 });

 it('сбой отправки в группу и повтор при следующем скане → ЛС ровно одно',async()=>{
  groupFailures=1;
  installFetch(targets(1));

  await scan();
  const afterFirst=tg.filter(c=>c.chat===String(TG)).length;
  await scan();

  expect(afterFirst).toBe(1);
  expect(leadIds()).toHaveLength(1);
  expect(tg.filter(c=>c.chat==='42')).toHaveLength(1);
  expect(tg.filter(c=>c.chat===String(TG))).toHaveLength(1);
 });

 it('тёплый лид → только группа',async()=>{
  temperature='warm';
  installFetch(targets(1));

  await scan();

  expect(tg.filter(c=>c.chat==='42')).toHaveLength(1);
  expect(tg.filter(c=>c.chat===String(TG))).toHaveLength(0);
 });
});
