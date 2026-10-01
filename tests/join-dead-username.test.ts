import { describe, expect, it } from "vitest";
import {
  USERNAME_DEAD_AFTER_ACCOUNTS,
  classifyJoinFailure,
  clearAccountSideJoinError,
  planGroupHeal,
  recordUsernameMissing,
  seedMissingAccounts,
} from "@/lib/processes/join-flow";

describe("«Слот не видит @» — witnesses are counted, only t.me marks dead", () => {
  it("each distinct account is counted once; K witnesses alone do not mark the link dead", () => {
    expect(USERNAME_DEAD_AFTER_ACCOUNTS).toBe(3);
    let g: Record<string, unknown> = { accountId: "a1", url: "https://t.me/dead_link_test" };
    let step = recordUsernameMissing(g, "a1", "Слот не видит @dead_link_test");
    expect(step.dead).toBe(false);
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a1", "Слот не видит @dead_link_test");
    expect(step.missingAccounts).toEqual(["a1"]);
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a2", "x");
    g = { ...g, ...step.patch };
    step = recordUsernameMissing(g, "a3", "x");
    expect(step.missingAccounts).toEqual(["a1", "a2", "a3"]);
    expect(step.dead).toBe(false);
    expect(step.patch.joinDead).toBeUndefined();
    expect(step.patch.status).toBeUndefined();
  });

  it("a witness on a group t.me already confirmed missing marks it dead", () => {
    const g = { accountId: "a1", url: "https://t.me/dead_link_test", tmeMissing: true };
    const step = recordUsernameMissing(g, "a1", "Слот не видит @dead_link_test");
    expect(step.dead).toBe(true);
    expect(step.patch).toMatchObject({ joinDead: true, joinGaveUp: true, status: "error", joinState: "" });
  });

  it("a dead group leaves the heal queue", () => {
    expect(planGroupHeal({ group: { membership: "none", accountId: "a1", joinDead: true, joinWanted: true }, accountStatus: "active" })).toBe(
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

describe("migration: account-side join errors leave the group", () => {
  const base = { accountId: "acc12345-0000", membership: "none", joinedAt: "", joinStateError: "" };

  it("«аккаунт не резолвит даже @telegram» → status setup, text moves to joinAccountError", () => {
    const text = "Аккаунт не резолвит даже @telegram — ограничен Telegram, @x тут ни при чём";
    const next = clearAccountSideJoinError({ ...base, status: "error", error: text });
    expect(next).toMatchObject({ status: "setup", error: "", joinAccountError: text, joinAccountErrorId: "acc12345-0000" });
  });

  it("«Слот не видит @x … ложь фермы» is account-side too", () => {
    const text = "Слот не видит @x (ResolveUsername). Часто ложь фермы — нужен другой аккаунт";
    const next = clearAccountSideJoinError({ ...base, status: "error", error: "", joinStateError: text });
    expect(next).toMatchObject({ status: "setup", error: "", joinStateError: "", joinAccountError: text });
  });

  it("an error status without any reason becomes setup without an account error", () => {
    const next = clearAccountSideJoinError({ ...base, accountId: "", status: "error", error: "" });
    expect(next).toMatchObject({ status: "setup", error: "", joinAccountErrorId: "" });
    expect(next.joinAccountError || "").toBe("");
  });

  it("a real group error, a member and a dead link are untouched (same object)", () => {
    const privateGroup = { ...base, status: "error", error: "Группа приватная — нужен инвайт" };
    expect(clearAccountSideJoinError(privateGroup)).toBe(privateGroup);
    const member = { ...base, membership: "joined", status: "error", error: "FloodWait 300" };
    expect(clearAccountSideJoinError(member)).toBe(member);
    const dead = { ...base, joinDead: true, status: "error", error: "Слот не видит @x" };
    expect(clearAccountSideJoinError(dead)).toBe(dead);
    const fine = { ...base, status: "setup", error: "" };
    expect(clearAccountSideJoinError(fine)).toBe(fine);
  });
});
