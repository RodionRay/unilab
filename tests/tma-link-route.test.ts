import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,OWNER,SETTINGS_ID,authState,login,resetWorkspace,testDb} from './helpers/workspace-harness';
import {addMember,clearTmaState,linkTelegram,prepareTmaTables,wsKeyOf} from './helpers/tma-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST as linkPOST} from '@/app/api/tma/link/route';
import {findActiveLinkForUser,redeemLinkCode} from '@/lib/tma/links';
import {miniAppUrl} from '@/lib/tma/link-api';
import type {LinkStatus,TmaError} from '@/lib/tma/contract';

const botCalls:string[]=[];

function stubBot(username='unilab_test_bot'){
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  botCalls.push(String(url).split('/').pop()||'');
  return Response.json({ok:true,result:{id:123456,is_bot:true,username}});
 }));
}

async function call(body:Record<string,unknown>,headers:Record<string,string>={}){
 const res=await linkPOST(new Request('http://crm.test/api/tma/link',{
  method:'POST',headers:{'Content-Type':'application/json',origin:'http://crm.test',...headers},body:JSON.stringify(body),
 }));
 return {status:res.status,json:await res.json() as LinkStatus&TmaError};
}

function patchSettings(patch:Record<string,unknown>){
 const {sqlite}=testDb();
 const row=sqlite.prepare('SELECT data FROM records WHERE id=?').get(SETTINGS_ID) as {data:string};
 sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),...patch}),SETTINGS_ID);
}

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(()=>{
 vi.stubEnv('SESSION_SECRET','x'.repeat(48));
 resetWorkspace();
 clearTmaState();
 botCalls.length=0;
 stubBot();
 login(OWNER);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

describe('POST /api/tma/link',()=>{
 it('без cookie → 401; чужой Origin → 403; bearer не заменяет cookie',async()=>{
  authState.user=null;
  const anon=await call({action:'status'},{authorization:'Bearer tma.a.b'});
  login(OWNER);
  const cross=await call({action:'status'},{origin:'https://evil.example'});

  expect(anon.status).toBe(401);
  expect(cross.status).toBe(403);
 });

 it('REQ-L1: create_code → ссылка t.me/<bot>?start=link_<code> (≤64 символа payload), срок 10 мин, getMe кеширует username',async()=>{
  const r=await call({action:'create_code'});

  expect(r.status).toBe(200);
  expect(r.json.startLink).toMatch(/^https:\/\/t\.me\/unilab_test_bot\?start=link_[A-Za-z0-9_-]{32}$/);
  const payload=new URL(r.json.startLink!).searchParams.get('start')!;
  expect(payload.length).toBeLessThanOrEqual(64);
  expect(r.json.expiresAt!-Math.floor(Date.now()/1000)).toBeGreaterThan(590);
  expect(r.json.linked).toBe(false);
  expect(botCalls).toEqual(['getMe']);
  expect(JSON.stringify(r.json)).not.toContain(BOT_TOKEN);
  const redeemed=await redeemLinkCode(testDb().db,OWNER,payload,{id:77,username:'me'},'123456');
  expect(redeemed.ok).toBe(true);
 });

 it('create_code без токена бота → 409 с подсказкой; бот не отвечает → 502',async()=>{
  testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.notifyBotToken','') WHERE kind='settings'").run();
  const noBot=await call({action:'create_code'});
  testDb().sqlite.prepare("UPDATE records SET data=json_set(data,'$.notifyBotToken',?) WHERE kind='settings'").run(BOT_TOKEN);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:false,description:'Unauthorized'},{status:401})));
  const down=await call({action:'create_code'});

  expect([noBot.status,noBot.json.error]).toEqual([409,expect.stringContaining('бота')]);
  expect(down.status).toBe(502);
 });

 it('create_code ограничен по частоте (429)',async()=>{
  let last=null;
  for(let i=0;i<11;i++)last=await call({action:'create_code'});

  expect([last?.status,last?.json.code]).toEqual([429,'rate_limited']);
 });

 it('status / set_dm_notices / unlink себя',async()=>{
  await linkTelegram(OWNER,55);

  const s=await call({action:'status'});
  const on=await call({action:'set_dm_notices',enabled:true});
  const bad=await call({action:'set_dm_notices'});
  const off=await call({action:'unlink'});
  const notLinked=await call({action:'set_dm_notices',enabled:true});

  expect(s.json).toMatchObject({linked:true,tgUsername:'tg55',dmNotices:false});
  expect(on.json.dmNotices).toBe(true);
  expect(bad.status).toBe(400);
  expect(off.json.linked).toBe(false);
  expect([notLinked.status,notLinked.json.code]).toEqual([409,'not_linked']);
 });

 it('REQ-L4: админ отключает сотрудника своего кабинета; менеджер — нет; чужой кабинет — нет',async()=>{
  addMember('admin-1','admin');
  addMember('manager-1','manager');
  addMember('stranger','manager','owner-2');
  await linkTelegram('manager-1',61);
  await linkTelegram(OWNER,62);

  login('manager-1');
  const byManager=await call({action:'unlink',userId:OWNER});
  login('admin-1');
  const ownerByAdmin=await call({action:'unlink',userId:OWNER});
  const foreign=await call({action:'unlink',userId:'stranger'});
  const byAdmin=await call({action:'unlink',userId:'manager-1'});

  expect(byManager.status).toBe(403);
  expect(ownerByAdmin.status).toBe(403);
  expect(foreign.status).toBe(404);
  expect(byAdmin.json.linked).toBe(false);
  expect(await findActiveLinkForUser(testDb().db,OWNER,'manager-1')).toBeNull();
  expect(await findActiveLinkForUser(testDb().db,OWNER,OWNER)).not.toBeNull();
 });

 it('botLink: только когда кешированный username принадлежит текущему боту',async()=>{
  const before=await call({action:'status'});
  await call({action:'create_code'});
  const cached=await call({action:'status'});
  patchSettings({notifyBotToken:'999999:other-bot-token'});
  const swapped=await call({action:'status'});

  expect(before.json.botLink).toBe('');
  expect(cached.json.botLink).toBe('https://t.me/unilab_test_bot');
  expect(swapped.json.botLink).toBe('');
 });

 it('noticesOff повторяет выключатель уведомлений кабинета (settings.notifyEnabled)',async()=>{
  patchSettings({notifyEnabled:true});
  const on=await call({action:'status'});
  patchSettings({notifyEnabled:false});
  const off=await call({action:'status'});

  expect(on.json.noticesOff).toBe(false);
  expect(off.json.noticesOff).toBe(true);
 });

 it('appUrl только для https APP_URL',async()=>{
  const key=await wsKeyOf();
  vi.stubEnv('APP_URL','https://crm.example.com/');
  const r=await call({action:'status'});

  expect(r.json.appUrl).toBe(`https://crm.example.com/tma/${key}`);
  expect(miniAppUrl('http://localhost:5180',key)).toBe('');
  expect(miniAppUrl(undefined,key)).toBe('');
 });
});
