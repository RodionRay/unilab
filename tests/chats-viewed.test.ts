import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';
import {CHAT_LEAD,addChatLead,readRecord} from './helpers/chats-fixture';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {markLeadOpened} from '@/lib/lead-conversation';
import {ALL_CRM_ACCESS,ensureStaffTables} from '@/lib/staff';

const markViewed=()=>POST(postRequest({action:'mark_lead_viewed',id:CHAT_LEAD}));

describe('переписки · открытие чата → просмотрено (markLeadOpened, общий для UI и API)',()=>{
  it('новый ответ: viewed=false, needsManager → патч viewed и без менеджера',()=>{
    const patch=markLeadOpened({viewed:false,needsManager:true,viewedAt:''},'2026-09-30T08:00:00.000Z');

    expect(patch).toEqual({viewed:true,viewedAt:'2026-09-30T08:00:00.000Z',needsManager:false});
  });

  it('уже просмотренный без needsManager — патча нет (no-op)',()=>{
    expect(markLeadOpened({viewed:true,needsManager:false,viewedAt:'2026-09-18T10:00:00.000Z'},'2026-09-30T08:00:00.000Z')).toBeNull();
  });

  it('просмотренный + новый needsManager: очищается, viewedAt сохраняется',()=>{
    const patch=markLeadOpened({viewed:true,needsManager:true,viewedAt:'2026-09-18T10:00:00.000Z'},'2026-09-30T08:00:00.000Z');

    expect(patch).toEqual({viewed:true,viewedAt:'2026-09-18T10:00:00.000Z',needsManager:false});
  });
});

describe('переписки · mark_lead_viewed (API)',()=>{
  beforeAll(async()=>{
    testDb();
    await ensureStaffTables();
  });
  beforeEach(()=>{
    resetWorkspace();
    addChatLead();
  });

  it('владелец: лид становится просмотренным, needsManager снят',async()=>{
    login(OWNER);

    const res=await markViewed();

    expect(res.status).toBe(200);
    const lead=readRecord(CHAT_LEAD);
    expect(lead.viewed).toBe(true);
    expect(lead.needsManager).toBe(false);
    expect(lead.viewedAt).toBeTruthy();
  });

  it('REQ-C11: наблюдатель получает 403, лид остаётся непросмотренным',async()=>{
    testDb().sqlite.prepare('INSERT INTO workspace_members(id,workspace_owner_id,user_id,role,access,created) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),OWNER,'viewer-1','viewer',JSON.stringify({...ALL_CRM_ACCESS,staff:false}),new Date().toISOString());
    login('viewer-1');

    const res=await markViewed();

    expect(res.status).toBe(403);
    expect(readRecord(CHAT_LEAD)).toMatchObject({viewed:false,needsManager:true});
  });
});
