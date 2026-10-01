import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACCOUNT_ID,OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {seal} from '@/lib/server-store';
import {accountBlindPatch} from '@/lib/processes/join-flow';

const ACC_A='a0000000-0000-4000-8000-00000000000a';
const ACC_B='b0000000-0000-4000-8000-00000000000b';
const ACC_C='c0000000-0000-4000-8000-00000000000c';
const DEAD_PROXY='d0000000-0000-4000-8000-00000000000d';
const GROUP='e0000000-0000-4000-8000-00000000000e';

type WorkerReply=Record<string,unknown>;
const joinCalls:{session:string}[]=[];
let workerReply:WorkerReply={ok:true,join:'joined',status:'active'};

function rec(id:string){
  const row=testDb().sqlite.prepare('SELECT data FROM records WHERE id=?').get(id) as {data:string};
  return JSON.parse(row.data);
}
function patch(id:string,data:Record<string,unknown>){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...rec(id),...data}),id);
}
async function addAccount(id:string,data:Record<string,unknown>){
  addRecord(id,'account',{name:id.slice(0,1),status:'active',proxyId:'',limits:{invite:40},...data},
    await seal(JSON.stringify({kind:'session',zipBase64:id,apiId:1,apiHash:'h'}),OWNER));
}
function addGroup(data:Record<string,unknown>){
  addRecord(GROUP,'group',{name:'Целевая',url:'https://t.me/wanted_chat',membership:'none',status:'setup',joinedAt:'',joinWanted:true,accountId:ACC_A,...data});
}
const join=()=>POST(postRequest({action:'join_group',id:GROUP}));

describe('выбор аккаунта для вступления',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    vi.stubEnv('ENCRYPTION_KEY','ab'.repeat(32));
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(ACCOUNT_ID);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
    joinCalls.length=0;
    workerReply={ok:true,join:'joined',status:'active'};
    vi.stubGlobal('fetch',vi.fn(async(url:string,init?:{body?:string})=>{
      if(String(url).endsWith('/join-group')){
       joinCalls.push({session:String(JSON.parse(String(init?.body||'{}')).zipBase64||'')});
       return Response.json(workerReply);
      }
      return Response.json({ok:false,error:'not stubbed'},{status:500});
    }));
    addRecord(DEAD_PROXY,'proxy',{name:'dead',host:'198.51.100.40',port:1080,protocol:'socks5',status:'inactive'});
  });
  afterEach(()=>{
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('FloodWait держит аккаунт весь срок, а не 4 минуты паузы',async()=>{
    await addAccount(ACC_A,{});
    addGroup({});
    workerReply={ok:false,join:'flood',status:'setup',error:'FloodWait 3600с',waitSec:3600};

    const first=await join();
    expect(first.status).toBe(429);
    // Прошло 10 минут: обычная пауза уже кончилась, FloodWait — нет
    patch(ACC_A,{lastJoinAt:new Date(Date.now()-10*60_000).toISOString()});
    const second=await join();

    expect(second.status).toBe(429);
    expect(joinCalls).toHaveLength(1);
    expect(Date.parse(rec(ACC_A).joinFloodUntil)).toBeGreaterThan(Date.now()+3000_000);
  });

  it('сбой прокси при вступлении помечает аккаунт и не штрафует группу',async()=>{
    await addAccount(ACC_A,{});
    addGroup({});
    workerReply={ok:false,status:'proxy_error',error:'Proxy connection to telegram failed'};

    await join();

    expect(rec(ACC_A).status).toBe('proxy_error');
    expect(rec(GROUP).joinAttempts||0).toBe(0);
  });

  it('отозванная сессия при вступлении помечает аккаунт unauthorized',async()=>{
    await addAccount(ACC_A,{});
    addGroup({});
    workerReply={ok:false,status:'unauthorized',error:'AuthKeyUnregisteredError'};

    await join();

    expect(rec(ACC_A).status).toBe('unauthorized');
    expect(rec(GROUP).joinAttempts||0).toBe(0);
  });

  it('сбой самого воркера (disconnected) не метит аккаунт и не штрафует группу',async()=>{
    await addAccount(ACC_A,{});
    addGroup({});
    workerReply={ok:false,status:'disconnected',error:'Таймаут воркера'};

    await join();

    expect(rec(ACC_A).status).toBe('active');
    expect(rec(GROUP).joinAttempts||0).toBe(0);
    expect(Date.parse(rec(GROUP).joinNextAt)).toBeGreaterThan(Date.now());
  });

  it('пересадка берёт готовый аккаунт раньше менее загруженного на паузе',async()=>{
    await addAccount(ACC_A,{status:'frozen'});
    await addAccount(ACC_B,{lastJoinAt:new Date().toISOString()});
    await addAccount(ACC_C,{});
    addRecord('f0000000-0000-4000-8000-00000000000f','group',{name:'Другая',url:'https://t.me/other_chat',membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active',accountId:ACC_C});
    addGroup({membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active'});

    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(rec(GROUP).accountId).toBe(ACC_C);
  });

  it('«already» не расходует дневной лимит и паузу вступлений',async()=>{
    await addAccount(ACC_A,{});
    addGroup({});
    workerReply={ok:true,join:'already',status:'active'};

    await join();

    expect(rec(ACC_A).joinsToday||0).toBe(0);
    expect(rec(ACC_A).lastJoinAt||'').toBe('');
  });

  it('обновление peer вступившей группы не идёт через отключённый аккаунт',async()=>{
    await addAccount(ACC_A,{status:'disconnected'});
    addGroup({membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active'});

    const res=await join();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(joinCalls).toHaveLength(0);
  });

  it('аккаунт с мёртвым прокси уступает вступление живому из фермы',async()=>{
    await addAccount(ACC_A,{proxyId:DEAD_PROXY});
    await addAccount(ACC_B,{});
    addGroup({});

    await join();

    expect(joinCalls.map(c=>c.session)).toEqual([ACC_B]);
    expect(rec(GROUP).accountId).toBe(ACC_B);
  });

  it('без готовых аккаунтов вступление не зовёт воркер с мёртвым прокси',async()=>{
    await addAccount(ACC_A,{proxyId:DEAD_PROXY});
    addGroup({});

    const res=await join();

    expect(res.status).toBe(429);
    expect(joinCalls).toHaveLength(0);
  });

  it('автопочинка пересаживает группу только на аккаунт, готовый вступать',async()=>{
    await addAccount(ACC_A,{status:'frozen'});
    await addAccount(ACC_B,{...accountBlindPatch()});
    await addAccount(ACC_C,{});
    addGroup({membership:'joined',joinedAt:'2026-09-01T00:00:00Z',status:'active'});

    await POST(postRequest({action:'heal_dead_group_accounts'}));

    expect(rec(GROUP).accountId).toBe(ACC_C);
  });

  it('заморозка при вступлении пересаживает группу на готовый аккаунт',async()=>{
    await addAccount(ACC_A,{});
    await addAccount(ACC_B,{proxyId:DEAD_PROXY});
    await addAccount(ACC_C,{});
    addGroup({});
    workerReply={ok:false,status:'frozen',join:'frozen',error:'FROZEN_METHOD_INVALID'};

    await join();

    expect(rec(ACC_A).status).toBe('frozen');
    expect(rec(GROUP).accountId).toBe(ACC_C);
  });

  it('assign_group_accounts не назначает слепой аккаунт',async()=>{
    await addAccount(ACC_B,{...accountBlindPatch()});
    addGroup({accountId:''});

    const res=await POST(postRequest({action:'assign_group_accounts',groupIds:[GROUP],accountIds:[ACC_B]}));

    expect(res.status).toBe(400);
    expect(rec(GROUP).accountId).toBe('');
  });

  it('слепой аккаунт не вешает ошибку на группу: status setup, текст в joinAccountError',async()=>{
    await addAccount(ACC_A,{});
    addGroup({status:'error',error:'',joinStateError:''});
    workerReply={ok:false,join:'missing',accountBlind:true,error:'Аккаунт не резолвит даже @telegram — ограничен Telegram, @wanted_chat тут ни при чём'};

    await join();

    const g=rec(GROUP);
    expect(g.status).toBe('setup');
    expect(g.error).toBe('');
    expect(g.joinStateError).toBe('');
    expect(g.joinAccountError).toMatch(/не резолвит даже @telegram/);
    expect(g.joinAccountErrorId).toBe(ACC_A);
  });

  it('FloodWait и «Слот не видит @» без t.me — ошибка аккаунта, не группы',async()=>{
    await addAccount(ACC_A,{});
    addGroup({status:'active'});
    workerReply={ok:false,join:'missing',usernameMissing:true,error:'Слот не видит @wanted_chat (ResolveUsername). Часто ложь фермы — нужен другой аккаунт'};

    await join();

    const g=rec(GROUP);
    expect(g.status).toBe('active');
    expect(g.error).toBe('');
    expect(g.joinDead).toBeFalsy();
    expect(g.joinMissingAccounts).toEqual([ACC_A]);
    expect(g.joinAccountError).toMatch(/ложь фермы/);
  });

  it('успешное вступление снимает ошибку аккаунта',async()=>{
    await addAccount(ACC_A,{});
    addGroup({joinAccountError:'FloodWait 300',joinAccountErrorId:ACC_A});

    await join();

    expect(rec(GROUP)).toMatchObject({membership:'joined',joinAccountError:'',joinAccountErrorId:''});
  });

  it('назначение другого аккаунта снимает ошибку аккаунта',async()=>{
    await addAccount(ACC_C,{});
    addGroup({joinAccountError:'FloodWait 300',joinAccountErrorId:ACC_A});

    const res=await POST(postRequest({action:'assign_group_accounts',groupIds:[GROUP],accountIds:[ACC_C]}));

    expect(res.status).toBe(200);
    expect(rec(GROUP)).toMatchObject({accountId:ACC_C,joinAccountError:'',joinAccountErrorId:''});
  });

  it('import_catalog не привязывает каталог к замороженному аккаунту',async()=>{
    await addAccount(ACC_A,{status:'frozen'});

    const res=await POST(postRequest({action:'import_catalog',accountId:ACC_A}));

    expect(res.status).toBe(400);
  });
});
