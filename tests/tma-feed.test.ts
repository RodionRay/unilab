import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,BOT_TOKEN,LEAD_ID,MAILING_ID,OWNER,addRecord,authState,login,resetWorkspace,testDb} from './helpers/workspace-harness';
import {addMember,clearTmaState,feedRequest,initDataFor,linkTelegram,prepareTmaTables,sessionRequest,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST as sessionPOST} from '@/app/api/tma/session/route';
import {GET as feedGET} from '@/app/api/tma/feed/route';
import {ALL_CRM_ACCESS,ROLE_PRESETS} from '@/lib/staff';
import {FEED_PAGE_SIZE,type AccountsFeed,type InboxFeed,type LeadFeed,type OverviewFeed,type TasksFeed,type TmaError} from '@/lib/tma/contract';
import {accountHealth,maskPhone,moscowMidnightIso} from '@/lib/tma/feed-ops';

let tgSeq=1000;

async function tokenFor(userId:string){
 const tg=++tgSeq;
 await linkTelegram(userId,tg);
 const res=await sessionPOST(sessionRequest({wsKey:await wsKeyOf(),initData:initDataFor(tg)}));
 expect(res.status).toBe(200);
 return (await res.json() as {token:string}).token;
}

async function feed<T>(token:string|null,query:string){
 const res=await feedGET(feedRequest(token,query));
 return {status:res.status,json:await res.json() as T&TmaError};
}

function addLead(data:Record<string,unknown>,created=new Date().toISOString()){
 const id=crypto.randomUUID();
 testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
  .run(id,OWNER,'lead',JSON.stringify({name:'L',message:'Ищу поставщика',status:'new',temperature:'warm',...data}),null,created);
 return id;
}

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(()=>{
 vi.stubEnv('SESSION_SECRET','x'.repeat(48));
 resetWorkspace();
 clearTmaState();
 authState.user=null;
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

describe('GET /api/tma/feed · доступ',()=>{
 it('без bearer (даже с cookie) → 401 session_expired',async()=>{
  login(OWNER);

  const r=await feed(null,'view=overview');

  expect([r.status,r.json.code]).toEqual([401,'session_expired']);
 });

 it('неизвестный view / битый курсор → 400 bad_request',async()=>{
  const token=await tokenFor(OWNER);

  expect((await feed(token,'view=dump')).status).toBe(400);
  expect((await feed(token,'view=inbox&cursor=zzz')).json.code).toBe('bad_request');
 });

 it.each([
  ['inbox',{...ALL_CRM_ACCESS,leads:false,chats:false}],
  ['lead',{...ALL_CRM_ACCESS,leads:false,chats:false}],
  ['accounts',{...ALL_CRM_ACCESS,accounts:false}],
  ['overview',{...ALL_CRM_ACCESS,overview:false}],
  ['tasks',{...ALL_CRM_ACCESS,mailing:false,audience:false,invite:false,groups:false}],
 ] as const)('без раздела view=%s → 403 forbidden',async(view,access)=>{
  addMember('op-1','operator',OWNER,{...access,staff:false});
  const token=await tokenFor('op-1');

  const r=await feed(token,`view=${view}&id=${LEAD_ID}`);

  expect([r.status,r.json.code]).toEqual([403,'forbidden']);
 });
});

describe('REQ-M1 · inbox',()=>{
 it('страницы по FEED_PAGE_SIZE с курсором, без повторов; непрочитанные первыми; архив скрыт',async()=>{
  testDb().sqlite.exec("DELETE FROM records WHERE kind='lead'");
  const t0=Date.parse('2026-09-01T00:00:00.000Z');
  for(let i=0;i<64;i++)addLead({viewed:i%2===0,name:`L${i}`},new Date(t0+i*60_000).toISOString());
  addLead({status:'archived',viewed:false});
  const token=await tokenFor(OWNER);

  const ids:string[]=[];
  let cursor='';
  const pages:InboxFeed[]=[];
  for(let n=0;n<5;n++){
   const r=await feed<InboxFeed>(token,`view=inbox${cursor?`&cursor=${cursor}`:''}`);
   expect(r.status).toBe(200);
   pages.push(r.json);
   ids.push(...r.json.items.map(x=>x.id));
   if(!r.json.nextCursor)break;
   cursor=r.json.nextCursor;
  }

  expect(pages.map(p=>p.items.length)).toEqual([FEED_PAGE_SIZE,FEED_PAGE_SIZE,4]);
  expect(new Set(ids).size).toBe(64);
  const unreadFlags=pages.flatMap(p=>p.items.map(x=>x.unread));
  expect(unreadFlags.slice(0,32).every(Boolean)).toBe(true);
  expect(unreadFlags.slice(32).some(Boolean)).toBe(false);
  expect(pages[0].counts).toEqual({hot:0,unread:32});
  expect(pages[0].items[0]).toEqual({
   id:expect.any(String),name:'L63',username:'',temperature:'warm',preview:'Ищу поставщика',at:expect.any(String),
   unread:true,needsManager:false,conversation:false,source:'',reason:'',
  });
 });

 it('фильтры hot и conversations; превью = последнее сообщение переписки',async()=>{
  addLead({temperature:'hot'});
  const conv=addLead({conversationOpen:true,replies:[{text:'Привет',mode:'dm',at:'2026-09-30T10:00:00.000Z',ok:true,from:'client'}]});
  const token=await tokenFor(OWNER);

  const hot=await feed<InboxFeed>(token,'view=inbox&filter=hot');
  const convs=await feed<InboxFeed>(token,'view=inbox&filter=conversations');

  expect(hot.json.items.map(x=>x.temperature)).toEqual(['hot']);
  expect(convs.json.items.map(x=>x.id)).toEqual([conv]);
  expect(convs.json.items[0]).toMatchObject({preview:'Привет',conversation:true});
 });
});

describe('REQ-M2 · lead',()=>{
 it('история → messages, черновик, canReply по правилам отправки',async()=>{
  const id=addLead({
   senderUsername:'client',draft:'Черновик',reason:'Ищет',
   replies:[
    {text:'Здравствуйте',mode:'dm',at:'2026-09-30T10:00:00.000Z',ok:true,from:'us'},
    {text:'Да',mode:'dm',at:'2026-09-30T10:05:00.000Z',ok:true,from:'client'},
    {text:'Сбой',mode:'dm',at:'2026-09-30T10:06:00.000Z',ok:false,status:'failed',error:'PEER_FLOOD',from:'us'},
   ],
  });
  const token=await tokenFor(OWNER);

  const r=await feed<LeadFeed>(token,`view=lead&id=${id}`);

  expect(r.status).toBe(200);
  expect(r.json.lead).toMatchObject({id,username:'client',draft:'Черновик',reason:'Ищет',canReply:true});
  expect(r.json.lead.messages).toEqual([
   {from:'us',text:'Здравствуйте',at:'2026-09-30T10:00:00.000Z',status:'sent'},
   {from:'client',text:'Да',at:'2026-09-30T10:05:00.000Z',status:'sent'},
   {from:'us',text:'Сбой',at:'2026-09-30T10:06:00.000Z',status:'failed',error:'PEER_FLOOD'},
  ]);
 });

 it('нет id/username клиента → canReply=false с причиной; аккаунт переписки на отлёжке → false',async()=>{
  const noPeer=addLead({});
  addRecord(crypto.randomUUID(),'account',{name:'A',phone:'+79990000000',status:'cooldown',cooldownUntil:new Date(Date.now()+3600_000).toISOString()});
  const acc=(testDb().sqlite.prepare("SELECT id FROM records WHERE kind='account' AND json_extract(data,'$.status')='cooldown'").get() as {id:string}).id;
  const resting=addLead({senderId:'777',accountId:acc,conversationOpen:true});
  const token=await tokenFor(OWNER);

  const a=await feed<LeadFeed>(token,`view=lead&id=${noPeer}`);
  const b=await feed<LeadFeed>(token,`view=lead&id=${resting}`);

  expect(a.json.lead).toMatchObject({canReply:false,replyBlockedReason:expect.stringContaining('username')});
  expect(b.json.lead).toMatchObject({canReply:false,replyBlockedReason:expect.stringContaining('отлежке')});
 });

 it('наблюдатель видит лид, но canReply=false; лид чужого кабинета → 404',async()=>{
  const id=addLead({senderId:'777'});
  testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
   .run('eeeeeeee-0000-4000-8000-00000000000e','owner-x','lead','{"name":"X"}',null,new Date().toISOString());
  addMember('viewer-1','viewer',OWNER,{...ALL_CRM_ACCESS,staff:false});
  const token=await tokenFor('viewer-1');

  const r=await feed<LeadFeed>(token,`view=lead&id=${id}`);
  const foreign=await feed<LeadFeed>(token,'view=lead&id=eeeeeeee-0000-4000-8000-00000000000e');

  expect(r.json.lead).toMatchObject({canReply:false,replyBlockedReason:expect.stringContaining('Наблюдатель')});
  expect(foreign.status).toBe(404);
 });
});

describe('REQ-M3 · accounts',()=>{
 it('телефон маскирован, здоровье, лимиты использования',async()=>{
  const token=await tokenFor(OWNER);

  const r=await feed<AccountsFeed>(token,'view=accounts');

  expect(r.status).toBe(200);
  expect(r.json.items).toEqual([{
   id:ACCOUNT_ID,name:'Farm 1',phone:'+7 *** ** 22',username:'',health:'ok',statusLabel:'Активный',
   caps:[{label:'Сообщения',used:0,limit:10},{label:'Вступления',used:0,limit:10},{label:'Инвайты',used:0,limit:40}],
   reason:'',lastCheckedAt:'',checking:false,
  }]);
 });

 it('accountHealth: сетап / ошибки / пауза / ok',()=>{
  const base={cooldownUntil:'',floodUntil:'',lastChecked:''};
  const future=new Date(Date.now()+60_000).toISOString();

  expect(accountHealth({...base,status:'setup'})).toBe('setup');
  expect(accountHealth({...base,status:'frozen'})).toBe('error');
  expect(accountHealth({...base,status:'spamblock'})).toBe('error');
  expect(accountHealth({...base,status:'spamblock',cooldownUntil:future})).toBe('paused');
  expect(accountHealth({...base,status:'cooldown',cooldownUntil:future})).toBe('paused');
  expect(accountHealth({...base,status:'active',floodUntil:future})).toBe('paused');
  expect(accountHealth({...base,status:'active'})).toBe('ok');
  expect(maskPhone('+380501234567')).toBe('+3 *** ** 67');
 });
});

describe('REQ-M4 · tasks',()=>{
 it('статус → доступное действие; наблюдатель без действий; автообход только с разделом «Группы»',async()=>{
  addRecord(crypto.randomUUID(),'audience_task',{name:'Сбор',status:'running',collected:5,total:50,deliveries:[]});
  addMember('mailer','operator',OWNER,{...ROLE_PRESETS.operator,mailing:true,groups:false,audience:false,invite:false});
  addMember('viewer-1','viewer',OWNER,{...ALL_CRM_ACCESS,staff:false});
  const owner=await tokenFor(OWNER);
  const mailer=await tokenFor('mailer');
  const viewer=await tokenFor('viewer-1');

  const all=(await feed<TasksFeed>(owner,'view=tasks')).json.items;
  const mailerItems=(await feed<TasksFeed>(mailer,'view=tasks')).json.items;
  const viewerItems=(await feed<TasksFeed>(viewer,'view=tasks')).json.items;

  expect(all.map(t=>[t.kind,t.status,t.actions])).toEqual(expect.arrayContaining([
   ['auto_rescan','running',[]],
   ['audience','running',['pause_audience']],
   ['mailing','paused',['start_mailing']],
  ]));
  expect(all.find(t=>t.kind==='audience')?.progress).toEqual({done:5,total:50});
  expect(mailerItems.map(t=>[t.id,t.actions])).toEqual([[MAILING_ID,['start_mailing']]]);
  expect(viewerItems.every(t=>t.actions.length===0)).toBe(true);
 });
});

describe('REQ-M5 · overview',()=>{
 it('сегодняшние лиды/ответы/отправки с московской полуночи и сводка аккаунтов/задач',async()=>{
  const today=new Date().toISOString();
  addLead({temperature:'hot',replies:[{text:'ok',mode:'dm',at:today,ok:true,from:'client'}]});
  addLead({},'2020-01-01T00:00:00.000Z');
  const token=await tokenFor(OWNER);

  const r=await feed<OverviewFeed>(token,'view=overview');

  expect(r.json.today).toMatchObject({hotLeads:1,replies:1,sent:0,invites:0});
  expect(r.json.today.newLeads).toBeGreaterThanOrEqual(2);
  expect(r.json.accounts).toEqual({total:1,ok:1,problems:0});
  expect(r.json.tasks).toEqual({running:0,paused:1,error:0});
 });

 it('московская полночь: 2026-10-01T22:30Z → 2026-10-01T21:00Z',()=>{
  expect(moscowMidnightIso(Date.parse('2026-10-01T22:30:00.000Z'))).toBe('2026-10-01T21:00:00.000Z');
  expect(moscowMidnightIso(Date.parse('2026-10-01T20:59:00.000Z'))).toBe('2026-09-30T21:00:00.000Z');
 });
});

describe('REQ-A7 · ни один view не отдаёт секреты',()=>{
 it('токен бота, sealed-сессия, пароль прокси, session-строка не встречаются в ответах',async()=>{
  const planted=['SESSIONSTRING-PLANTED','proxy-pass-PLANTED'];
  testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.sessionString',?,'$.proxyPassword',?) WHERE id=?").run(planted[0],planted[1],ACCOUNT_ID);
  testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.password',?) WHERE kind='proxy'").run(planted[1]);
  const lead=addLead({senderId:'1',notifyBotToken:BOT_TOKEN});
  const token=await tokenFor(OWNER);

  for(const q of ['view=overview','view=inbox',`view=lead&id=${lead}`,`view=lead&id=${LEAD_ID}`,'view=accounts','view=tasks']){
   const body=JSON.stringify((await feed(token,q)).json);
   for(const secret of [BOT_TOKEN,'sealed-session',...planted])expect(body,`${q} leaks ${secret}`).not.toContain(secret);
  }
 });
});
