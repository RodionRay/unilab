import { describe, expect, it } from "vitest";
import {
  accountJoinCapacity,
  byLimitMessage,
  countOpenAssignments,
  planAssignmentByLimit,
  type CapacityAccount,
} from "@/lib/join-capacity";
import { moscowDayKey } from "@/lib/telegram-accounts";

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const today = moscowDayKey();

const account = (id: string, extra: Partial<CapacityAccount> & { data?: Record<string, unknown> } = {}): CapacityAccount => ({
  id,
  created: daysAgo(60),
  assignedOpen: 0,
  ...extra,
  data: { status: "active", limits: { invite: 40 }, ...(extra.data || {}) },
});
const group = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  data: { name: id, url: `https://t.me/${id}_chat`, membership: "none", status: "setup", accountId: "", ...extra },
});

describe("accountJoinCapacity (REQ-6)", () => {
  it("an aged account gets the aged daily cap", () => {
    expect(accountJoinCapacity(account("a"), 0, NOW)).toBe(20);
  });

  it("a fresh account is held to its warm-up cap (5 in the first 3 days)", () => {
    expect(accountJoinCapacity(account("a", { created: daysAgo(1) }), 0, NOW)).toBe(5);
    expect(accountJoinCapacity(account("a", { created: daysAgo(5) }), 0, NOW)).toBe(10);
  });

  it("the default invite quota (10) wins over the aged cap when no limit is configured", () => {
    expect(accountJoinCapacity(account("a", { data: { limits: undefined } }), 0, NOW)).toBe(10);
  });

  it("a configured invite limit lower than the cap wins and today's joins count", () => {
    expect(accountJoinCapacity(account("a", { data: { limits: { invite: 3 }, joinsToday: 1, joinsDay: today } }), 0, NOW)).toBe(2);
  });

  it("yesterday's joins do not count", () => {
    expect(accountJoinCapacity(account("a", { data: { limits: { invite: 3 }, joinsToday: 3, joinsDay: "2000-01-01" } }), 0, NOW)).toBe(3);
  });

  it("open assignments consume capacity and never push it below zero", () => {
    expect(accountJoinCapacity(account("a"), 18, NOW)).toBe(2);
    expect(accountJoinCapacity(account("a"), 50, NOW)).toBe(0);
  });
});

describe("countOpenAssignments (REQ-6)", () => {
  it("counts assigned groups that are not joined, not pending and not in error", () => {
    const groups = [
      group("g1", { accountId: "a" }),
      group("g2", { accountId: "a" }),
      group("g3", { accountId: "a", membership: "joined" }),
      group("g4", { accountId: "a", status: "pending" }),
      group("g5", { accountId: "a", status: "error", error: "приватная" }),
      group("g6", { accountId: "a", joinAccountError: "FloodWait" }),
      group("g7", { accountId: "b" }),
      group("g8", {}),
    ];
    const open = countOpenAssignments(groups);
    expect(open.get("a")).toBe(2);
    expect(open.get("b")).toBe(1);
  });

  it("skips the groups that are being re-planned", () => {
    const groups = [group("g1", { accountId: "a" }), group("g2", { accountId: "a" })];
    expect(countOpenAssignments(groups, new Set(["g1"])).get("a")).toBe(1);
  });
});

describe("planAssignmentByLimit (REQ-5, REQ-7)", () => {
  it("spreads round-robin starting with the account that has the most capacity", () => {
    const plan = planAssignmentByLimit(
      ["g1", "g2", "g3", "g4"].map((id) => group(id)),
      [account("small", { data: { limits: { invite: 1 } } }), account("big", { data: { limits: { invite: 3 } } })],
      NOW,
    );
    expect(plan.assignments).toEqual([
      { groupId: "g1", accountId: "big" },
      { groupId: "g2", accountId: "small" },
      { groupId: "g3", accountId: "big" },
      { groupId: "g4", accountId: "big" },
    ]);
    expect(plan.capacity).toBe(4);
    expect(plan.unassigned).toEqual([]);
  });

  it("groups beyond today's total capacity stay unassigned, in the given order", () => {
    const plan = planAssignmentByLimit(
      ["g1", "g2", "g3", "g4", "g5", "g6", "g7"].map((id) => group(id)),
      [account("fresh", { created: daysAgo(1) })],
      NOW,
    );
    expect(plan.assignments.map((a) => a.groupId)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    expect(plan.unassigned).toEqual(["g6", "g7"]);
    expect(plan.capacity).toBe(5);
  });

  it("joined and pending groups are skipped and consume no capacity", () => {
    const plan = planAssignmentByLimit(
      [group("joined", { membership: "joined" }), group("req", { status: "pending" }), group("g1")],
      [account("a", { data: { limits: { invite: 1 } } })],
      NOW,
    );
    expect(plan.skipped).toEqual(["joined", "req"]);
    expect(plan.assignments).toEqual([{ groupId: "g1", accountId: "a" }]);
  });

  it("subtracts open assignments given per account", () => {
    const plan = planAssignmentByLimit(
      ["g1", "g2", "g3"].map((id) => group(id)),
      [account("a", { assignedOpen: 18 })],
      NOW,
    );
    expect(plan.capacity).toBe(2);
    expect(plan.unassigned).toEqual(["g3"]);
  });

  it("zero capacity plans nothing", () => {
    const plan = planAssignmentByLimit(
      ["g1", "g2"].map((id) => group(id)),
      [account("a", { created: daysAgo(1), data: { joinsToday: 5, joinsDay: today } })],
      NOW,
    );
    expect(plan.capacity).toBe(0);
    expect(plan.assignments).toEqual([]);
    expect(plan.unassigned).toEqual(["g1", "g2"]);
  });

  it("is deterministic for the same input (idempotent re-run)", () => {
    const groups = ["g1", "g2", "g3"].map((id) => group(id));
    const accounts = [account("b", { data: { limits: { invite: 2 } } }), account("a", { data: { limits: { invite: 2 } } })];
    expect(planAssignmentByLimit(groups, accounts, NOW)).toEqual(planAssignmentByLimit(groups, [...accounts].reverse(), NOW));
  });
});

describe("byLimitMessage (REQ-7)", () => {
  it("states assigned, unassigned and the capacity when the limit runs out", () => {
    expect(byLimitMessage({ assigned: 5, unassigned: 2, capacity: 5, skipped: 0 })).toBe(
      "Назначено 5, без аккаунта 2 — лимит на сегодня исчерпан (ёмкость 5)",
    );
  });

  it("says nothing was written when the capacity is 0", () => {
    expect(byLimitMessage({ assigned: 0, unassigned: 3, capacity: 0, skipped: 0 })).toBe(
      "Лимит на сегодня исчерпан у всех аккаунтов — ничего не назначено (ёмкость 0)",
    );
  });

  it("reports a full assignment and skipped members", () => {
    expect(byLimitMessage({ assigned: 3, unassigned: 0, capacity: 10, skipped: 2 })).toBe(
      "Назначено 3 (ёмкость 10) · вступившие и заявки пропущены: 2",
    );
  });
});
