import { describe, expect, it } from 'vitest';
import { assignOutcomeNotice, groupAccountLocked } from '@/lib/group-account-lock';

describe('groupAccountLocked', () => {
  it('locks joined, pending and joinedAt groups', () => {
    expect(groupAccountLocked({ membership: 'joined' })).toBe(true);
    expect(groupAccountLocked({ membership: 'pending' })).toBe(true);
    expect(groupAccountLocked({ status: 'pending' })).toBe(true);
    expect(groupAccountLocked({ joinedAt: '2026-10-01T07:00:00Z' })).toBe(true);
  });

  it('leaves not-joined groups free to reassign', () => {
    expect(groupAccountLocked({ membership: 'none', status: 'setup' })).toBe(false);
    expect(groupAccountLocked({})).toBe(false);
    expect(groupAccountLocked(null)).toBe(false);
  });
});

describe('assignOutcomeNotice', () => {
  it('reports success only when the group was really updated', () => {
    expect(assignOutcomeNotice({ updated: 1, skipped: 0 })).toEqual({ ok: true, text: 'Аккаунт назначен' });
  });

  it('says the account was not changed when the joined group was skipped', () => {
    const n = assignOutcomeNotice({ updated: 0, skipped: 1 });
    expect(n.ok).toBe(false);
    expect(n.text).toMatch(/не сменён.*вступлена/);
  });

  it('says not changed when nothing was updated or skipped', () => {
    expect(assignOutcomeNotice({}).ok).toBe(false);
  });
});
