/**
 * How many more groups each farm account may be given today, and the «Распределить по лимитам» plan.
 * Pure: the route (`assign_group_accounts` mode `by_limit`) is authoritative, the groups page previews
 * the same numbers. docs/join-pipeline.md §7, spec groups-filters-bulk-assign REQ-5..8.
 */

import { groupHasJoinError, groupIsMember, type GroupTabData } from "@/lib/group-tabs";
import { accountAgeDays, joinsLeftToday, type PacedAccount } from "@/lib/join-pacing";
import { DEFAULT_ACCOUNT_LIMITS, normalizeJoinsToday } from "@/lib/telegram-accounts";

export type CapacityAccount = {
  id: string;
  data: PacedAccount;
  /** Record creation time = days in the farm (warm-up). */
  created?: string;
  /** Groups already assigned to this account outside the planned set that still wait for a join. */
  assignedOpen?: number;
};

export type CapacityGroup = { id: string; data: GroupTabData & { accountId?: string } };

export type GroupAssignment = { groupId: string; accountId: string };

export type AssignmentPlan = {
  assignments: GroupAssignment[];
  /** Over today's capacity, in the given order; their current account stays untouched. */
  unassigned: string[];
  /** Joined or pending: never reassigned and consume no capacity. */
  skipped: string[];
  /** Sum of the accounts' remaining capacity before this plan. */
  capacity: number;
};

/**
 * Invites left today under `limits.invite` (default 10, `hasInviteQuota`'s rule). A limit ≤ 0 means
 * no own ceiling; the pacing cap still applies.
 */
function inviteQuotaLeft(data: PacedAccount): number {
  const limit = Number(data.limits?.invite ?? DEFAULT_ACCOUNT_LIMITS.invite);
  if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - normalizeJoinsToday(data));
}

/** min(joins left today incl. warm-up, invite quota left) − open assignments; never below 0 (REQ-6). */
export function accountJoinCapacity(
  account: Pick<CapacityAccount, "data" | "created">,
  assignedOpen: number,
  now = Date.now(),
): number {
  const left = Math.min(joinsLeftToday(account.data, accountAgeDays(account.created, now)), inviteQuotaLeft(account.data));
  return Math.max(0, left - Math.max(0, assignedOpen));
}

/** An assigned group that still waits for a join and holds a slot of its account's day. */
function holdsJoinSlot(data: CapacityGroup["data"]): boolean {
  return !!String(data.accountId || "") && !groupIsMember(data) && !groupHasJoinError(data);
}

/** Open assignments per account; `exclude` = the groups being re-planned (re-run stays idempotent). */
export function countOpenAssignments(
  groups: readonly CapacityGroup[],
  exclude: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const open = new Map<string, number>();
  for (const g of groups) {
    if (exclude.has(g.id) || !holdsJoinSlot(g.data)) continue;
    const id = String(g.data.accountId);
    open.set(id, (open.get(id) || 0) + 1);
  }
  return open;
}

/**
 * Takes groups in the given (visible) order and spreads them round-robin over accounts, the one
 * with the most capacity first (ties by id, so the plan does not depend on the input order of
 * accounts). Each account gets at most its capacity; the rest stays unassigned.
 */
export function planAssignmentByLimit(
  groups: readonly CapacityGroup[],
  accounts: readonly CapacityAccount[],
  now = Date.now(),
): AssignmentPlan {
  const slots = accounts
    .map((a) => ({ id: a.id, left: accountJoinCapacity(a, a.assignedOpen ?? 0, now) }))
    .filter((s) => s.left > 0)
    .sort((x, y) => y.left - x.left || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const capacity = slots.reduce((n, s) => n + s.left, 0);
  const plan: AssignmentPlan = { assignments: [], unassigned: [], skipped: [], capacity };
  let cursor = 0;
  for (const g of groups) {
    if (groupIsMember(g.data)) {
      plan.skipped.push(g.id);
      continue;
    }
    const slot = nextSlot(slots, cursor);
    if (!slot) {
      plan.unassigned.push(g.id);
      continue;
    }
    slot.entry.left--;
    cursor = slot.index + 1;
    plan.assignments.push({ groupId: g.id, accountId: slot.entry.id });
  }
  return plan;
}

function nextSlot<T extends { left: number }>(slots: T[], from: number): { entry: T; index: number } | null {
  for (let i = 0; i < slots.length; i++) {
    const index = (from + i) % slots.length;
    const entry = slots[index]!;
    if (entry.left > 0) return { entry, index };
  }
  return null;
}

/** The result line of REQ-7, shared by the route response and the page. */
export function byLimitMessage(r: { assigned: number; unassigned: number; capacity: number; skipped: number }): string {
  const skipped = r.skipped > 0 ? ` · вступившие и заявки пропущены: ${r.skipped}` : "";
  if (r.capacity <= 0) return `Лимит на сегодня исчерпан у всех аккаунтов — ничего не назначено (ёмкость 0)${skipped}`;
  if (r.unassigned > 0) {
    return `Назначено ${r.assigned}, без аккаунта ${r.unassigned} — лимит на сегодня исчерпан (ёмкость ${r.capacity})${skipped}`;
  }
  return `Назначено ${r.assigned} (ёмкость ${r.capacity})${skipped}`;
}
