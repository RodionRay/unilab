/**
 * How many more groups each farm account may be given today, and the «Распределить по лимитам» plan.
 * Pure: the route (`assign_group_accounts` mode `by_limit`) is authoritative, the groups page previews
 * the same numbers. docs/join-pipeline.md §7, spec groups-filters-bulk-assign REQ-5..8.
 */

import { groupTab, type GroupTabData } from "@/lib/group-tabs";
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
  /** New account per group (no account or a non-farm one) — the only rows to write. */
  assignments: GroupAssignment[];
  /** Already on a farm account that has capacity for it: left as is, its capacity is spent. */
  kept: string[];
  /** Assignments that replace a non-farm account («Сменим аккаунт»). */
  replaced: number;
  /** Over today's capacity, in the given order; their current account stays untouched. */
  unassigned: string[];
  /** Not for joining (member, request, error, relevance gate closed, no real link): no capacity used. */
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

/**
 * The farm would join this group: the «Ждут» tab rule (lib/group-tabs::groupTab) — not a member or
 * request, no join error, relevance gate open, a real link (not a catalog placeholder).
 */
export function groupJoinableByFarm(data: CapacityGroup["data"]): boolean {
  return groupTab(data) === "need";
}

/** An assigned group the farm will join: it holds a slot of its account's day. */
function holdsJoinSlot(data: CapacityGroup["data"]): boolean {
  return !!String(data.accountId || "") && groupJoinableByFarm(data);
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
 * Takes the joinable groups in the given (visible) order. A group already on a farm account keeps it
 * and spends that account's capacity first (stable re-runs); the others are spread round-robin over
 * accounts, the one with the most capacity first (ties by id, so the plan does not depend on the
 * input order of accounts). Each account gets at most its capacity; the rest stays unassigned.
 */
export function planAssignmentByLimit(
  groups: readonly CapacityGroup[],
  accounts: readonly CapacityAccount[],
  now = Date.now(),
): AssignmentPlan {
  const all = accounts
    .map((a) => ({ id: a.id, left: accountJoinCapacity(a, a.assignedOpen ?? 0, now) }))
    .sort((x, y) => y.left - x.left || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const farm = new Map(all.map((s) => [s.id, s]));
  const capacity = all.reduce((n, s) => n + s.left, 0);
  const plan: AssignmentPlan = { assignments: [], kept: [], replaced: 0, unassigned: [], skipped: [], capacity };
  const overflow = new Set<string>();
  const open: CapacityGroup[] = [];
  for (const g of groups) {
    if (!groupJoinableByFarm(g.data)) {
      plan.skipped.push(g.id);
      continue;
    }
    const own = farm.get(String(g.data.accountId || ""));
    if (!own) {
      open.push(g);
    } else if (own.left > 0) {
      own.left--;
      plan.kept.push(g.id);
    } else {
      overflow.add(g.id);
    }
  }
  const slots = all.filter((s) => s.left > 0);
  let cursor = 0;
  for (const g of open) {
    const slot = nextSlot(slots, cursor);
    if (!slot) {
      overflow.add(g.id);
      continue;
    }
    slot.entry.left--;
    cursor = slot.index + 1;
    plan.assignments.push({ groupId: g.id, accountId: slot.entry.id });
    if (String(g.data.accountId || "")) plan.replaced++;
  }
  plan.unassigned = groups.filter((g) => overflow.has(g.id)).map((g) => g.id);
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

/** The result line of REQ-7, shared by the route response and the page; `assigned` = written + kept. */
export function byLimitMessage(r: { assigned: number; unassigned: number; capacity: number; skipped: number }): string {
  const skipped = r.skipped > 0 ? ` · пропущено ${r.skipped} — не для вступления` : "";
  if (r.capacity <= 0) return `Лимит на сегодня исчерпан у всех аккаунтов — ничего не назначено (ёмкость 0)${skipped}`;
  if (r.unassigned > 0) {
    return `Назначено ${r.assigned}, не назначено ${r.unassigned} — лимит на сегодня исчерпан (ёмкость ${r.capacity})${skipped}`;
  }
  return `Назначено ${r.assigned} (ёмкость ${r.capacity})${skipped}`;
}
