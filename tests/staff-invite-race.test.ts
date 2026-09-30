import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createTestD1,type TestD1} from './helpers/d1-sqlite';

const cf=vi.hoisted(()=>({env:{} as {DB?:unknown}}));
vi.mock('cloudflare:workers',()=>cf);

import {acceptInvite,createInvite,ensureStaffTables} from '@/lib/staff';

let t:TestD1;

beforeAll(async()=>{
  t=createTestD1();
  cf.env.DB=t.db;
  await ensureStaffTables();
});

beforeEach(()=>{
  t.sqlite.exec('DELETE FROM workspace_members; DELETE FROM workspace_invites;');
});

describe('acceptInvite: одно приглашение — один сотрудник',()=>{
  it('второй параллельный accept того же токена отклоняется',async()=>{
    const invite=await createInvite({workspaceOwnerId:'owner-1',role:'manager'});

    const [a,b]=await Promise.all([
      acceptInvite({token:invite.token,userId:'user-a'}),
      acceptInvite({token:invite.token,userId:'user-b'}),
    ]);

    expect([a.ok,b.ok].filter(Boolean)).toHaveLength(1);
    const members=t.sqlite.prepare('SELECT user_id FROM workspace_members WHERE workspace_owner_id=?').all('owner-1');
    expect(members).toHaveLength(1);
    const row=t.sqlite.prepare('SELECT accepted_by FROM workspace_invites WHERE id=?').get(invite.id) as {accepted_by:string};
    expect(row.accepted_by).toBe((members[0] as {user_id:string}).user_id);
  });

  it('повторный accept после использования отклоняется',async()=>{
    const invite=await createInvite({workspaceOwnerId:'owner-1',role:'viewer'});
    expect((await acceptInvite({token:invite.token,userId:'user-a'})).ok).toBe(true);

    const again=await acceptInvite({token:invite.token,userId:'user-b'});

    expect(again).toEqual({ok:false,error:'Приглашение уже использовано'});
  });

  it('параллельные accept в два разных кабинета дают одно членство',async()=>{
    const first=await createInvite({workspaceOwnerId:'owner-1',role:'viewer'});
    const second=await createInvite({workspaceOwnerId:'owner-2',role:'viewer'});

    const results=await Promise.all([
      acceptInvite({token:first.token,userId:'user-a'}),
      acceptInvite({token:second.token,userId:'user-a'}),
    ]);

    expect(results.filter((r)=>r.ok)).toHaveLength(1);
    const members=t.sqlite.prepare('SELECT workspace_owner_id FROM workspace_members WHERE user_id=?').all('user-a') as {workspace_owner_id:string}[];
    expect(members).toHaveLength(1);
    const losing=results[0]!.ok?second:first;
    const row=t.sqlite.prepare('SELECT accepted_by FROM workspace_invites WHERE id=?').get(losing.id) as {accepted_by:string|null};
    expect(row.accepted_by).toBeNull();
  });

  it('отказ из-за членства в другом кабинете не сжигает приглашение',async()=>{
    const other=await createInvite({workspaceOwnerId:'owner-2',role:'viewer'});
    await acceptInvite({token:other.token,userId:'user-a'});
    const invite=await createInvite({workspaceOwnerId:'owner-1',role:'viewer'});

    expect((await acceptInvite({token:invite.token,userId:'user-a'})).ok).toBe(false);

    expect((await acceptInvite({token:invite.token,userId:'user-b'})).ok).toBe(true);
  });
});
