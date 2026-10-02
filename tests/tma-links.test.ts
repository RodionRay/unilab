import {readFileSync} from 'node:fs';
import path from 'node:path';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);

import {ROLE_PRESETS,ensureStaffTables,type StaffRole} from '@/lib/staff';
import {ensureUserTables} from '@/lib/users';
import {
 LINK_CODE_TTL_MS,createLinkCode,findActiveLink,listDmRecipients,redeemLinkCode,resolveTelegramLink,
 revokeLink,setDmError,setDmNotices,
} from '@/lib/tma/links';
import {TMA_DDL,ensureTmaTables,getOrCreateWorkspaceKey} from '@/lib/tma/workspace';
import {WS_KEY_RE} from '@/lib/tma/contract';

const OTHER_OWNER='owner-2';
const TG={id:424242,username:'anna_mgr'};
const BOT='7000001';

function addMember(userId:string,role:StaffRole,owner=OWNER){
 testDb().sqlite.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
  .run(crypto.randomUUID(),owner,userId,role,JSON.stringify(ROLE_PRESETS[role]),new Date().toISOString());
}

function activeLinks(owner=OWNER){
 return testDb().sqlite.prepare('SELECT * FROM tma_links WHERE owner=? AND revoked_at IS NULL').all(owner) as Record<string,unknown>[];
}

beforeAll(async()=>{
 const {db}=testDb();
 await ensureStaffTables();
 await ensureUserTables();
 await ensureTmaTables(db);
});

beforeEach(()=>{
 const {sqlite}=testDb();
 sqlite.exec('DELETE FROM tma_links; DELETE FROM tma_link_codes; DELETE FROM tma_workspaces; DELETE FROM workspace_members; DELETE FROM oauth_accounts;');
 try{sqlite.exec('DELETE FROM rate_limits;')}catch{/* created on first consume */}
 addMember('manager-1','manager');
});

describe('drizzle/0002_tma.sql ≡ рантайм DDL',()=>{
 it('миграция и ensureTmaTables создают одно и то же',()=>{
  const norm=(s:string)=>s.replace(/`/g,'').replace(/\s+/g,' ').replace(/\( /g,'(').replace(/ \)/g,')').trim();
  const file=readFileSync(path.resolve(__dirname,'../drizzle/0002_tma.sql'),'utf8')
   .split('--> statement-breakpoint').map(s=>norm(s.replace(/;\s*$/,''))).filter(Boolean);

  expect(file).toEqual(TMA_DDL.map(norm));
 });
});

describe('wsKey',()=>{
 it('создаётся один раз на кабинет, формат WS_KEY_RE, у разных кабинетов разный',async()=>{
  const {db}=testDb();
  const a=await getOrCreateWorkspaceKey(db,OWNER);

  expect(a).toMatch(WS_KEY_RE);
  expect(await getOrCreateWorkspaceKey(db,OWNER)).toBe(a);
  expect(await getOrCreateWorkspaceKey(db,OTHER_OWNER)).not.toBe(a);
 });
});

describe('REQ-L1/L2/L5 · код привязки',()=>{
 it('код ≥128 бит, start-параметр link_<code> ≤ 64 символов, срок 10 мин; хранится только хеш',async()=>{
  const {db,sqlite}=testDb();
  const now=Date.now();
  const {code,expiresAt}=await createLinkCode(db,OWNER,'manager-1',now);

  expect(Buffer.from(code,'base64url').length*8).toBeGreaterThanOrEqual(128);
  expect(`link_${code}`.length).toBeLessThanOrEqual(64);
  expect(expiresAt).toBe(now+LINK_CODE_TTL_MS);
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM tma_link_codes').all())).not.toContain(code);
 });

 it('погашение привязывает tg к сотруднику; повтор того же кода → used',async()=>{
  const {db}=testDb();
  const {code}=await createLinkCode(db,OWNER,'manager-1');

  const first=await redeemLinkCode(db,OWNER,`link_${code}`,TG,BOT);
  const second=await redeemLinkCode(db,OWNER,code,{id:999,username:'x'},BOT);

  expect(first).toMatchObject({ok:true,userId:'manager-1'});
  expect(second).toEqual({ok:false,reason:'used'});
  expect((await findActiveLink(db,OWNER,TG.id))?.userId).toBe('manager-1');
  expect(await findActiveLink(db,OWNER,999)).toBeNull();
 });

 it('просроченный код → expired, ссылка не создаётся',async()=>{
  const {db}=testDb();
  const t0=Date.now();
  const {code}=await createLinkCode(db,OWNER,'manager-1',t0);

  expect(await redeemLinkCode(db,OWNER,code,TG,BOT,t0+LINK_CODE_TTL_MS)).toEqual({ok:false,reason:'expired'});
  expect(activeLinks()).toHaveLength(0);
 });

 it('код чужого кабинета (тот же бот у двух кабинетов) → foreign, код остаётся годным для своего кабинета',async()=>{
  const {db}=testDb();
  const {code}=await createLinkCode(db,OWNER,'manager-1');

  expect(await redeemLinkCode(db,OTHER_OWNER,code,TG,BOT)).toEqual({ok:false,reason:'foreign'});
  expect(activeLinks(OTHER_OWNER)).toHaveLength(0);
  expect((await redeemLinkCode(db,OWNER,code,TG,BOT)).ok).toBe(true);
 });

 it('мусор / неизвестный код → invalid',async()=>{
  const {db}=testDb();

  expect(await redeemLinkCode(db,OWNER,'link_short',TG,BOT)).toEqual({ok:false,reason:'invalid'});
  expect(await redeemLinkCode(db,OWNER,'A'.repeat(32),TG,BOT)).toEqual({ok:false,reason:'invalid'});
 });

 it('сотрудника удалили между выпуском и погашением → invalid',async()=>{
  const {db,sqlite}=testDb();
  const {code}=await createLinkCode(db,OWNER,'manager-1');
  sqlite.exec('DELETE FROM workspace_members');

  expect(await redeemLinkCode(db,OWNER,code,TG,BOT)).toEqual({ok:false,reason:'invalid'});
  expect(activeLinks()).toHaveLength(0);
 });

 it('REQ-A8: перебор кодов одним tg-пользователем упирается в лимит',async()=>{
  const {db}=testDb();
  const results=[];
  for(let i=0;i<11;i++)results.push(await redeemLinkCode(db,OWNER,'B'.repeat(32),TG,BOT));

  expect(results.at(-1)).toEqual({ok:false,reason:'rate_limited'});
 });

 it('REQ-A8: 60 мусорных /start link_x от одного чужака не блокируют чужой годный код',async()=>{
  const {db}=testDb();
  const stranger={id:666,username:'spam'};
  for(let i=0;i<60;i++)await redeemLinkCode(db,OWNER,'link_x',stranger,BOT);
  const {code}=await createLinkCode(db,OWNER,'manager-1');

  expect(await redeemLinkCode(db,OWNER,'link_x',stranger,BOT)).toEqual({ok:false,reason:'rate_limited'});
  expect(await redeemLinkCode(db,OWNER,`link_${code}`,TG,BOT)).toMatchObject({ok:true,userId:'manager-1'});
 });

 it('REQ-A8: 60 неудачных правильных по формату кодов от разных tg блокируют кабинет',async()=>{
  const {db}=testDb();
  for(let i=0;i<60;i++)await redeemLinkCode(db,OWNER,'C'.repeat(32),{id:5000+i,username:''},BOT);
  const {code}=await createLinkCode(db,OWNER,'manager-1');

  expect(await redeemLinkCode(db,OWNER,code,TG,BOT)).toEqual({ok:false,reason:'rate_limited'});
 });

 it('REQ-A8: удачные погашения не тратят лимит кабинета',async()=>{
  const {db}=testDb();
  for(let i=0;i<60;i++){
   const {code}=await createLinkCode(db,OWNER,'manager-1');
   expect((await redeemLinkCode(db,OWNER,code,{id:7000+i,username:''},BOT)).ok).toBe(true);
  }
  const {code}=await createLinkCode(db,OWNER,'manager-1');

  expect((await redeemLinkCode(db,OWNER,code,TG,BOT)).ok).toBe(true);
 });

 it('один tg ↔ один сотрудник: новый код другого сотрудника перепривязывает tg, старая ссылка отозвана',async()=>{
  const {db}=testDb();
  addMember('operator-1','operator');
  await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,'manager-1')).code,TG,BOT);

  await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,'operator-1')).code,TG,BOT);

  const rows=activeLinks();
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe('operator-1');
 });

 it('повторная привязка того же tg к тому же сотруднику сохраняет ссылку (живые сессии не рвутся)',async()=>{
  const {db}=testDb();
  const a=await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,'manager-1')).code,TG,BOT);
  const b=await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,'manager-1')).code,TG,BOT);

  expect(a.ok&&b.ok&&a.linkId===b.linkId).toBe(true);
 });

 it('частичный уникальный индекс не даёт двух активных ссылок одного tg в кабинете',()=>{
  const {sqlite}=testDb();
  const ins=sqlite.prepare("INSERT INTO tma_links(id,owner,user_id,tg_user_id,created) VALUES(?,?,?,?,?)");
  ins.run('l1',OWNER,'u1','1','x');

  expect(()=>ins.run('l2',OWNER,'u2','1','x')).toThrow();
  sqlite.prepare("UPDATE tma_links SET revoked_at='y' WHERE id='l1'").run();
  expect(()=>ins.run('l3',OWNER,'u2','1','x')).not.toThrow();
 });
});

describe('REQ-L3 · Login Widget (oauth_accounts) без кода',()=>{
 function addOauth(userId:string,tgId:number){
  testDb().sqlite.prepare("INSERT INTO oauth_accounts(id,user_id,provider,provider_user_id,created) VALUES(?,?,?,?,?)")
   .run(crypto.randomUUID(),userId,'telegram',String(tgId),'x');
 }

 it('сотрудник этого кабинета с telegram oauth → ссылка создаётся лениво',async()=>{
  const {db}=testDb();
  addOauth('manager-1',TG.id);

  const link=await resolveTelegramLink(db,OWNER,TG,BOT);

  expect(link?.userId).toBe('manager-1');
  expect(activeLinks()).toHaveLength(1);
 });

 it('oauth-пользователь из другого кабинета → нет ссылки',async()=>{
  const {db}=testDb();
  addMember('stranger','manager',OTHER_OWNER);
  addOauth('stranger',TG.id);

  expect(await resolveTelegramLink(db,OWNER,TG,BOT)).toBeNull();
 });

 it('после «Отключить» Login Widget не перепривязывает автоматически',async()=>{
  const {db}=testDb();
  addOauth('manager-1',TG.id);
  await resolveTelegramLink(db,OWNER,TG,BOT);
  await revokeLink(db,OWNER,'manager-1');

  expect(await resolveTelegramLink(db,OWNER,TG,BOT)).toBeNull();
 });
});

describe('уведомления в личку',()=>{
 it('opt-in → в списке; ошибка доставки выключает opt-in (REQ-N2); удалённый сотрудник выпадает',async()=>{
  const {db,sqlite}=testDb();
  await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,'manager-1')).code,TG,BOT);
  expect(await setDmNotices(db,OWNER,'manager-1',true)).toBe(true);

  expect(await listDmRecipients(db,OWNER)).toEqual([expect.objectContaining({userId:'manager-1',tgUserId:TG.id,canSeeLeads:true})]);

  await setDmError(db,OWNER,TG.id,'Forbidden: bot was blocked by the user');
  expect(await listDmRecipients(db,OWNER)).toEqual([]);
  expect(String((sqlite.prepare('SELECT dm_error FROM tma_links').get() as {dm_error:string}).dm_error)).toContain('blocked');

  await setDmNotices(db,OWNER,'manager-1',true);
  sqlite.exec('DELETE FROM workspace_members');
  expect(await listDmRecipients(db,OWNER)).toEqual([]);
 });

 it('владелец кабинета тоже получатель; без привязки setDmNotices → false',async()=>{
  const {db}=testDb();
  await redeemLinkCode(db,OWNER,(await createLinkCode(db,OWNER,OWNER)).code,TG,BOT);
  await setDmNotices(db,OWNER,OWNER,true);

  expect(await listDmRecipients(db,OWNER)).toEqual([expect.objectContaining({userId:OWNER,canSeeLeads:true})]);
  expect(await setDmNotices(db,OWNER,'manager-1',true)).toBe(false);
 });
});
