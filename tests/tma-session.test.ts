import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {BOT_TOKEN,LEAD_ID,OWNER,PROXY_ID,SETTINGS_ID,authState,login,resetWorkspace,testDb} from './helpers/workspace-harness';
import {
 HARNESS_BOT_ID,addMember,bearerPost,clearTmaState,initDataFor,linkTelegram,prepareTmaTables,sessionRequest,wsKeyOf,
} from './helpers/tma-harness';
import {nowSec} from './helpers/tma-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
 ...await importOriginal<typeof import('@/lib/auth')>(),
 getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST as sessionPOST} from '@/app/api/tma/session/route';
import {GET as workspaceGET,POST as workspacePOST} from '@/app/api/workspace/route';
import {POST as staffPOST} from '@/app/api/staff/route';
import {revokeLink} from '@/lib/tma/links';
import {rememberBotIdentity} from '@/lib/tma/workspace';
import {issueTmaToken} from '@/lib/tma/session';
import type {SessionResponse,TmaError} from '@/lib/tma/contract';

const TG=424242;
const OWNER_B='owner-b';
const LEAD_B='bbbbbbbb-0000-4000-8000-00000000000b';

async function exchange(body:Record<string,unknown>,ip?:string){
 const res=await sessionPOST(sessionRequest(body,ip));
 return {res,json:await res.json() as SessionResponse&TmaError};
}

async function sessionFor(tgId:number,owner=OWNER){
 const {res,json}=await exchange({wsKey:await wsKeyOf(owner),initData:initDataFor(tgId)});
 expect(res.status).toBe(200);
 return json.token;
}

function setBotToken(token:string,owner=OWNER){
 const row=testDb().sqlite.prepare("SELECT id,data FROM records WHERE owner=? AND kind='settings'").get(owner) as {id:string;data:string};
 testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),notifyBotToken:token}),row.id);
}

function addWorkspaceB(){
 const ins=testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)');
 ins.run(crypto.randomUUID(),OWNER_B,'settings',JSON.stringify({name:'B',notifyBotToken:BOT_TOKEN}),null,new Date().toISOString());
 ins.run(LEAD_B,OWNER_B,'lead',JSON.stringify({name:'Lead B',message:'secret lead of B',status:'new'}),null,new Date().toISOString());
}

const markViewed=(token:string,id=LEAD_ID)=>workspacePOST(bearerPost(token,{action:'mark_lead_viewed',id}));

beforeAll(async()=>{
 testDb();
 await prepareTmaTables();
});
beforeEach(()=>{
 vi.stubEnv('SESSION_SECRET','x'.repeat(48));
 resetWorkspace();
 clearTmaState();
 // No cookie session unless a test logs in: the bearer must stand on its own.
 authState.user=null;
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});

describe('POST /api/tma/session',()=>{

 it('REQ-A4: привязанный сотрудник получает bearer ≤1 ч, роль и доступы; cookie не ставится',async()=>{
  addMember('manager-1','manager');
  await linkTelegram('manager-1',TG);

  const {res,json}=await exchange({wsKey:await wsKeyOf(),initData:initDataFor(TG)});

  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(json.token.startsWith('tma.')).toBe(true);
  expect(json.expiresAt-nowSec()).toBeLessThanOrEqual(3600);
  expect(json.me.role).toBe('manager');
  expect(json.me.access).toContain('leads');
  expect(json.me.access).not.toContain('staff');
  expect(json.workspace.name).toBe('Проект');
  expect(JSON.stringify(json)).not.toContain(BOT_TOKEN);
 });

 it('REQ-A1: подпись чужим токеном → 401 invalid_init_data без деталей',async()=>{
  await linkTelegram(OWNER,TG);

  const {res,json}=await exchange({wsKey:await wsKeyOf(),initData:initDataFor(TG,'999:other')});

  expect(res.status).toBe(401);
  expect(json.code).toBe('invalid_init_data');
  expect(json.token).toBeUndefined();
 });

 it('REQ-A2: старый auth_date → 401 init_data_expired',async()=>{
  await linkTelegram(OWNER,TG);

  const {res,json}=await exchange({wsKey:await wsKeyOf(),initData:initDataFor(TG,BOT_TOKEN,nowSec()-7200)});

  expect(res.status).toBe(401);
  expect(json.code).toBe('init_data_expired');
 });

 it('REQ-A3: неизвестный wsKey и кабинет без токена бота → 403 workspace_unavailable',async()=>{
  const unknown=await exchange({wsKey:'A'.repeat(32),initData:initDataFor(TG)});
  const key=await wsKeyOf();
  setBotToken('');
  const noBot=await exchange({wsKey:key,initData:initDataFor(TG)});

  expect([unknown.res.status,unknown.json.code]).toEqual([403,'workspace_unavailable']);
  expect([noBot.res.status,noBot.json.code]).toEqual([403,'workspace_unavailable']);
 });

 it('REQ-A3: не привязан → 403 not_linked; ссылка на бота, если её username известен',async()=>{
  const key=await wsKeyOf();
  const bare=await exchange({wsKey:key,initData:initDataFor(TG)});
  await rememberBotIdentity(testDb().db,OWNER,HARNESS_BOT_ID,'unilab_test_bot');
  const withLink=await exchange({wsKey:key,initData:initDataFor(TG)});

  expect([bare.res.status,bare.json.code,bare.json.botLink]).toEqual([403,'not_linked',undefined]);
  expect(withLink.json.botLink).toBe('https://t.me/unilab_test_bot');
 });

 it('REQ-A3: ссылка есть, но сотрудника удалили из кабинета → 403 not_linked',async()=>{
  addMember('manager-1','manager');
  await linkTelegram('manager-1',TG);
  testDb().sqlite.exec('DELETE FROM workspace_members');

  const {res,json}=await exchange({wsKey:await wsKeyOf(),initData:initDataFor(TG)});

  expect([res.status,json.code]).toEqual([403,'not_linked']);
 });

 it('плохое тело → 400 bad_request',async()=>{
  const {res,json}=await exchange({wsKey:'bad key',initData:''});

  expect([res.status,json.code]).toEqual([400,'bad_request']);
 });

 it('REQ-A8: лимит по IP → 429 rate_limited (+Retry-After)',async()=>{
  const key=await wsKeyOf();
  let last:Awaited<ReturnType<typeof exchange>>|null=null;
  for(let i=0;i<31;i++)last=await exchange({wsKey:key,initData:initDataFor(TG,'1:x')});

  expect(last?.res.status).toBe(429);
  expect(Number(last?.res.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(last?.json.code).toBe('rate_limited');
 });

 it('REQ-A8: лимит по wsKey держит и при смене IP',async()=>{
  const key=await wsKeyOf();
  let last:Response|null=null;
  for(let i=0;i<301;i++)last=(await exchange({wsKey:key,initData:'x=1'},`198.51.100.${i%250}`)).res;

  expect(last?.status).toBe(429);
 });
});

describe('REQ-A9 · два кабинета на одном боте',()=>{

 it('ссылка только в A: обмен в B → not_linked; токен A не читает и не меняет данные B',async()=>{
  addWorkspaceB();
  await linkTelegram(OWNER,TG);

  const inB=await exchange({wsKey:await wsKeyOf(OWNER_B),initData:initDataFor(TG)});
  const tokenA=await sessionFor(TG);
  const touchB=await markViewed(tokenA,LEAD_B);

  expect([inB.res.status,inB.json.code]).toEqual([403,'not_linked']);
  expect(touchB.status).toBe(404);
  const leadB=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(LEAD_B) as {data:string};
  expect(JSON.parse(leadB.data).viewed).toBeUndefined();
 });
});

describe('REQ-A5 · bearer на POST /api/workspace перепроверяется каждый раз',()=>{

 it('живая сессия владельца: разрешённое действие проходит',async()=>{
  await linkTelegram(OWNER,TG);
  const token=await sessionFor(TG);

  expect((await markViewed(token)).status).toBe(200);
 });

 it('смена токена бота (другой bot id) → 401',async()=>{
  await linkTelegram(OWNER,TG);
  const token=await sessionFor(TG);
  setBotToken('654321:rotated');

  expect((await markViewed(token)).status).toBe(401);
 });

 it('ссылка отозвана → 401',async()=>{
  addMember('manager-1','manager');
  await linkTelegram('manager-1',TG);
  const token=await sessionFor(TG);
  await revokeLink(testDb().db,OWNER,'manager-1');

  expect((await markViewed(token)).status).toBe(401);
 });

 it('сотрудника удалили → 401 (не откатывается в его собственный кабинет)',async()=>{
  addMember('manager-1','manager');
  await linkTelegram('manager-1',TG);
  const token=await sessionFor(TG);
  testDb().sqlite.exec('DELETE FROM workspace_members');

  expect((await markViewed(token)).status).toBe(401);
 });

 it('подделанный / просроченный / чужого формата bearer → 401, cookie не подхватывается',async()=>{
  const linkId=await linkTelegram(OWNER,TG);
  const token=await sessionFor(TG);
  const claims={sub:OWNER,own:OWNER,tg:TG,bot:HARNESS_BOT_ID,lnk:linkId};
  const expired=(await issueTmaToken(claims,nowSec()-3601)).token;
  login(OWNER);

  expect((await markViewed(token.slice(0,-2)+'xx')).status).toBe(401);
  expect((await markViewed(expired)).status).toBe(401);
 });

 it('REQ-A6: tma-админ не может check_proxy (на вебе может), владелец — delete/save настроек',async()=>{
  addMember('admin-1','admin');
  await linkTelegram('admin-1',TG);
  await linkTelegram(OWNER,TG+1);
  const admin=await sessionFor(TG);
  const owner=await sessionFor(TG+1);

  const proxy=await workspacePOST(bearerPost(admin,{action:'check_proxy',id:PROXY_ID}));
  const del=await workspacePOST(bearerPost(owner,{action:'delete',kind:'lead',id:LEAD_ID}));
  const settings=await workspacePOST(bearerPost(owner,{action:'save',kind:'settings',id:SETTINGS_ID,data:{name:'x'}}));

  expect(proxy.status).toBe(403);
  expect(del.status).toBe(403);
  expect(settings.status).toBe(403);
  expect((await del.json()).error).toContain('мини-приложении');
  expect(testDb().sqlite.prepare('SELECT id FROM records WHERE id=?').get(LEAD_ID)).toBeTruthy();
 });

 it('REQ-A6: наблюдатель через tma по-прежнему ничего не меняет',async()=>{
  addMember('viewer-1','viewer');
  await linkTelegram('viewer-1',TG);
  const token=await sessionFor(TG);

  expect((await markViewed(token)).status).toBe(403);
 });

 it('GET /api/workspace (полный дамп) и /api/staff не принимают bearer',async()=>{
  await linkTelegram(OWNER,TG);
  const token=await sessionFor(TG);
  const staff=await staffPOST(new Request('http://crm.test/api/staff',{
   method:'POST',headers:{'Content-Type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'list'}),
  }));

  expect((await workspaceGET()).status).toBe(401);
  expect(staff.status).toBe(401);
 });
});
