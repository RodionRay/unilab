import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/users',()=>({listUserIdsForCron:async()=>[
 {userId:'owner-1',email:'o1@example.com',name:'O1'},
 {userId:'owner-2',email:'o2@example.com',name:'O2'},
 {userId:'owner-3',email:'o3@example.com',name:'O3'},
]}));

import {POST as tasksTick} from '@/app/api/cron/tasks-tick/route';
import {verifySessionToken} from '@/lib/auth';
import {ensureTmaTables} from '@/lib/tma/workspace';

const SECRET='k'.repeat(40);
let n=0;

function settings(owner:string,data:Record<string,unknown>){
 testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
  .run(`b0000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,owner,'settings',JSON.stringify(data),null,new Date().toISOString());
}

describe('cron · опрос бота для привязки Telegram (REQ-L2)',()=>{
 const polled:string[]=[];

 beforeEach(async()=>{
  const {sqlite,db}=testDb();
  await ensureTmaTables(db);
  sqlite.exec('DELETE FROM records; DELETE FROM tma_links; DELETE FROM tma_link_codes;');
  polled.length=0;
  vi.stubEnv('CRON_SECRET',SECRET);
  vi.stubEnv('SESSION_SECRET','s'.repeat(40));
  vi.stubEnv('APP_URL','https://app.test');
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:{body?:string;headers:Record<string,string>})=>{
   const token=String(init.headers.Cookie).split('=').slice(1).join('=');
   const owner=String((await verifySessionToken(token))?.userId);
   if(init.body&&(JSON.parse(init.body) as {action:string}).action==='poll_bot_updates')polled.push(owner);
   return Response.json({ok:true});
  }));
 });
 afterEach(()=>{
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
 });

 it('токен без чата уведомлений: опрос только при ожидающем коде или активной привязке',async()=>{
  const {sqlite}=testDb();
  settings('owner-1',{notifyEnabled:false,notifyBotToken:'1:abc',notifyChatId:''});
  settings('owner-2',{notifyEnabled:false,notifyBotToken:'2:abc'});
  settings('owner-3',{notifyEnabled:false,notifyBotToken:'',notifyChatId:''});
  sqlite.prepare('INSERT INTO tma_link_codes(code_hash,owner,user_id,expires_at,used_at,created) VALUES(?,?,?,?,?,?)').run('h1','owner-1','owner-1',Date.now()+60_000,null,'');
  sqlite.prepare('INSERT INTO tma_link_codes(code_hash,owner,user_id,expires_at,used_at,created) VALUES(?,?,?,?,?,?)').run('h2','owner-2','owner-2',Date.now()-1,null,'');
  sqlite.prepare("INSERT INTO tma_links(id,owner,user_id,tg_user_id,created) VALUES('l3','owner-3','owner-3','5','')").run();

  const res=await tasksTick(new Request('https://app.test/api/cron/tasks-tick',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));

  expect(res.status).toBe(200);
  expect(polled).toEqual(['owner-1']);
 });

 it('активная привязка при токене → опрос',async()=>{
  settings('owner-2',{notifyBotToken:'2:abc'});
  testDb().sqlite.prepare("INSERT INTO tma_links(id,owner,user_id,tg_user_id,created) VALUES('l2','owner-2','owner-2','6','')").run();

  await tasksTick(new Request('https://app.test/api/cron/tasks-tick',{method:'POST',headers:{authorization:`Bearer ${SECRET}`}}));

  expect(polled).toEqual(['owner-2']);
 });
});
