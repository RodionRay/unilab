import { describe, expect, it } from "vitest";
import {
  USERNAME_DEAD_AFTER_ACCOUNTS,
  classifyJoinFailure,
  planGroupHeal,
  recordUsernameMissing,
  seedMissingAccounts,
} from "@/lib/processes/join-flow";

describe("«Слот не видит @» — cap distinct accounts, then mark dead", () => {
  it("each distinct account is counted once; the group dies at the K-th", () => {
    expect(USERNAME_DEAD_AFTER_ACCOUNTS).toBe(3);
    let g: Record<string, unknown> = { accountId: "a1", url: "https://t.me/dead_link_test" };
    let step = recordUsernameMissing(g, "a1", "Слот не видит @dead_link_test");
    expect(step.dead).toBe(false);
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a1", "Слот не видит @dead_link_test");
    expect(step.missingAccounts).toEqual(["a1"]);
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a2", "x");
    expect(step.dead).toBe(false);
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a3", "x");
    expect(step.dead).toBe(true);
    expect(step.patch).toMatchObject({ joinDead: true, joinGaveUp: true, status: "error", joinState: "" });
    expect(String(step.patch.error)).toMatch(/3 разных аккаунта/);
  });

  it("a dead group leaves the heal queue", () => {
    expect(planGroupHeal({ group: { membership: "none", accountId: "a1", joinDead: true }, accountStatus: "active" })).toBe(
      "gave_up",
    );
  });

  it("seeds the current account for groups that failed before tracking existed", () => {
    const g = { accountId: "a1", error: "Слот не видит @old_test", status: "error" };
    expect(seedMissingAccounts(g)).toMatchObject({ joinMissingAccounts: ["a1"] });
    const clean = { accountId: "a1", error: "" };
    expect(seedMissingAccounts(clean)).toBe(clean);
  });
});

describe("join failure classification", () => {
  it("separates spam signals, group faults and account faults", () => {
    expect(classifyJoinFailure({ join: "peer_flood", error: "PEER_FLOOD" })).toBe("peer_flood");
    expect(classifyJoinFailure({ join: "too_many", error: "CHANNELS_TOO_MUCH" })).toBe("channels_too_much");
    expect(classifyJoinFailure({ join: "private", error: "Группа приватная" })).toBe("group");
    expect(classifyJoinFailure({ join: "missing", error: "Слот не видит @x" })).toBe("group");
    expect(classifyJoinFailure({ join: "failed", error: "Telegram не подтвердил вступление" })).toBe("account");
  });
});
