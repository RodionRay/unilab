import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,addRecord,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {readRecord} from './helpers/chats-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {ALL_CRM_ACCESS,ensureStaffTables} from '@/lib/staff';

const LEAD_A='e0000000-0000-4000-8000-00000000000a';
const LEAD_B='e0000000-0000-4000-8000-00000000000b';
const FOREIGN='e0000000-0000-4000-8000-00000000000f';
const UNKNOWN='e0000000-0000-4000-8000-0000000000ff';

const triage=(ids:string[],to:string)=>POST(postRequest({action:'set_lead_triage',ids,triage:to}));

function addLead(id:string,data:Record<string,unknown>={}){
  addRecord(id,'lead',{name:id.slice(-1),message:'Ищу поставщика',status:'new',temperature:'hot',viewed:true,viewedAt:'2026-10-01T10:00:00.000Z',...data});
}

describe('«Лиды» · set_lead_triage (API)',()=>{
  beforeAll(async()=>{
    testDb();
    await ensureStaffTables();
  });
  beforeEach(()=>{
    resetWorkspace();
    addLead(LEAD_A);
    addLead(LEAD_B,{viewed:false});
    login(OWNER);
  });

  it('REQ-3/4: «В лиды» пачкой меняет только status, остальное в лиде не трогает',async()=>{
    const res=await triage([LEAD_A,LEAD_B],'lead');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ok:true,status:'working',changed:2,missing:[]});
    expect(readRecord(LEAD_A)).toMatchObject({status:'working',viewed:true,viewedAt:'2026-10-01T10:00:00.000Z',temperature:'hot'});
    expect(readRecord(LEAD_B)).toMatchObject({status:'working',viewed:false});
  });

  it('REQ-6 идемпотентно: повтор и дубли id ничего не меняют',async()=>{
    await triage([LEAD_A],'rejected');

    const res=await triage([LEAD_A,LEAD_A],'rejected');

    expect(await res.json()).toMatchObject({changed:0,missing:[]});
    expect(readRecord(LEAD_A).status).toBe('archived');
  });

  it('REQ-5 обратимо: «Не подходит» → «Вернуть в новые»',async()=>{
    await triage([LEAD_A],'rejected');

    await triage([LEAD_A],'new');

    expect(readRecord(LEAD_A).status).toBe('new');
  });

  it('REQ-1: mark_lead_viewed не меняет вкладку разбора',async()=>{
    await POST(postRequest({action:'mark_lead_viewed',id:LEAD_B}));

    expect(readRecord(LEAD_B)).toMatchObject({status:'new',viewed:true});
  });

  it('чужой и несуществующий лид — в missing, чужой не изменён',async()=>{
    testDb().sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
      .run(FOREIGN,'owner-2','lead',JSON.stringify({name:'x',status:'new'}),null,new Date().toISOString());

    const res=await triage([LEAD_A,FOREIGN,UNKNOWN],'lead');

    expect(await res.json()).toMatchObject({changed:1,missing:[FOREIGN,UNKNOWN]});
    expect(readRecord(FOREIGN).status).toBe('new');
  });

  it('невалидный запрос → 400: неизвестный разбор, пустой список, не uuid, >500 id',async()=>{
    expect((await triage([LEAD_A],'viewed')).status).toBe(400);
    expect((await triage([],'lead')).status).toBe(400);
    expect((await triage(['nope'],'lead')).status).toBe(400);
    expect((await triage(Array.from({length:501},()=>LEAD_A),'lead')).status).toBe(400);
    expect(readRecord(LEAD_A).status).toBe('new');
  });

  it('наблюдатель получает 403, лид остаётся в «Новых»',async()=>{
    testDb().sqlite.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),OWNER,'viewer-1','viewer',JSON.stringify({...ALL_CRM_ACCESS,staff:false}),new Date().toISOString());
    login('viewer-1');

    const res=await triage([LEAD_A],'lead');

    expect(res.status).toBe(403);
    expect(readRecord(LEAD_A).status).toBe('new');
  });
});
