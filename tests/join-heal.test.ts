import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BLIND_COOLDOWN_MS,
  JOIN_MAX_ATTEMPTS,
  JOIN_SUCCESS_PATCH,
  accountBlindPatch,
  isAccountBlindResult,
  isAccountResolveBlind,
  joinFailurePatch,
  joinRetryDelayMs,
  planGroupHeal,
} from "@/lib/processes/join-flow";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const joined = { membership: "joined", joinedAt: "2026-09-17T10:00:00Z", accountId: "a1" };
const fresh = { membership: "none", accountId: "a1", joinWanted: true };

describe("автопочинка групп · planGroupHeal", () => {
  it("не сбрасывает вступившую группу при временных сбоях аккаунта", () => {
    for (const st of ["active", "disconnected", "proxy_error", "checking", "cooldown", "spamblock"]) {
      expect(planGroupHeal({ group: joined, accountStatus: st, now: NOW })).toBe("keep");
    }
  });

  it("пересаживает вступившую группу только если аккаунт умер насовсем", () => {
    expect(planGroupHeal({ group: joined, accountStatus: "unauthorized", now: NOW })).toBe("reassign");
    expect(planGroupHeal({ group: joined, accountStatus: "frozen", now: NOW })).toBe("reassign");
    expect(planGroupHeal({ group: joined, accountStatus: null, now: NOW })).toBe("reassign");
  });

  it("возвращает группу на аккаунт, который уже в ней состоит", () => {
    const wiped = { membership: "none", accountId: "a2", joinedAccountId: "a1" };
    expect(
      planGroupHeal({ group: wiped, accountStatus: "active", previousAccountStatus: "active", now: NOW }),
    ).toBe("restore_previous");
    const wanted = { ...wiped, joinWanted: true };
    expect(
      planGroupHeal({ group: wanted, accountStatus: "active", previousAccountStatus: "frozen", now: NOW }),
    ).toBe("enqueue");
    expect(
      planGroupHeal({ group: wanted, accountStatus: "active", previousAccountStatus: null, now: NOW }),
    ).toBe("enqueue");
    expect(
      planGroupHeal({ group: wiped, accountStatus: "active", previousAccountStatus: "frozen", now: NOW }),
    ).toBe("not_wanted");
  });

  it("ставит в очередь невступившую группу, даже если слот на отлёжке", () => {
    expect(planGroupHeal({ group: fresh, accountStatus: "active", now: NOW })).toBe("enqueue");
    expect(planGroupHeal({ group: fresh, accountStatus: "cooldown", now: NOW })).toBe("enqueue");
    expect(planGroupHeal({ group: fresh, accountStatus: "frozen", now: NOW })).toBe("reassign");
  });

  it("не вступает в группу, которую владелец не ставил в очередь", () => {
    const catalog = { membership: "none", accountId: "a1" };
    expect(planGroupHeal({ group: catalog, accountStatus: "active", now: NOW })).toBe("not_wanted");
    expect(planGroupHeal({ group: { ...catalog, accountId: "" }, accountStatus: null, now: NOW })).toBe("not_wanted");
    expect(planGroupHeal({ group: catalog, accountStatus: "frozen", now: NOW })).toBe("not_wanted");
    expect(planGroupHeal({ group: { ...catalog, joinWanted: false }, accountStatus: "active", now: NOW })).toBe("not_wanted");
  });

  it("вступившую и ранее вступавшую группу чинит без флага очереди", () => {
    expect(planGroupHeal({ group: { membership: "joined", accountId: "a1" }, accountStatus: "frozen", now: NOW })).toBe("reassign");
    const wiped = { membership: "none", accountId: "a2", joinedAccountId: "a1" };
    expect(
      planGroupHeal({ group: wiped, accountStatus: "active", previousAccountStatus: "active", now: NOW }),
    ).toBe("restore_previous");
  });

  it("держит backoff и отказ после лимита попыток", () => {
    const later = new Date(NOW + 60_000).toISOString();
    const past = new Date(NOW - 60_000).toISOString();
    expect(planGroupHeal({ group: { ...fresh, joinNextAt: later }, accountStatus: "active", now: NOW })).toBe("wait");
    expect(planGroupHeal({ group: { ...fresh, joinNextAt: past }, accountStatus: "active", now: NOW })).toBe("enqueue");
    expect(planGroupHeal({ group: { ...fresh, joinGaveUp: true }, accountStatus: "active", now: NOW })).toBe("gave_up");
  });
});

describe("повторы вступления", () => {
  it("растит паузу экспоненциально с потолком 24 ч", () => {
    expect(joinRetryDelayMs(1)).toBe(30 * 60_000);
    expect(joinRetryDelayMs(2)).toBe(60 * 60_000);
    expect(joinRetryDelayMs(20)).toBe(24 * 60 * 60_000);
  });

  it("сдаётся на JOIN_MAX_ATTEMPTS и сбрасывается успехом", () => {
    let g: { joinAttempts?: number; joinNextAt?: string; joinGaveUp?: boolean } = {};
    for (let i = 1; i < JOIN_MAX_ATTEMPTS; i++) {
      g = joinFailurePatch(g, NOW);
      expect(g.joinGaveUp).toBe(false);
    }
    g = joinFailurePatch(g, NOW);
    expect(g.joinAttempts).toBe(JOIN_MAX_ATTEMPTS);
    expect(g.joinGaveUp).toBe(true);
    expect(Date.parse(g.joinNextAt!)).toBeGreaterThan(NOW);
    expect({ ...g, ...JOIN_SUCCESS_PATCH }).toEqual({ joinAttempts: 0, joinNextAt: "", joinGaveUp: false });
  });
});

describe("account resolve blindness", () => {
  it("recognises only an explicit worker accountBlind flag", () => {
    expect(isAccountBlindResult({ accountBlind: true })).toBe(true);
    expect(isAccountBlindResult({ accountBlind: "true" })).toBe(false);
    expect(isAccountBlindResult({})).toBe(false);
    expect(isAccountBlindResult(null)).toBe(false);
  });

  it("keeps a blind account out of the farm for the cooldown window only", () => {
    const acc = accountBlindPatch(NOW);
    expect(Date.parse(acc.resolveBlindUntil) - NOW).toBe(ACCOUNT_BLIND_COOLDOWN_MS);
    expect(isAccountResolveBlind(acc, NOW)).toBe(true);
    expect(isAccountResolveBlind(acc, NOW + ACCOUNT_BLIND_COOLDOWN_MS)).toBe(false);
    expect(isAccountResolveBlind({}, NOW)).toBe(false);
    expect(isAccountResolveBlind({ resolveBlindUntil: "garbage" }, NOW)).toBe(false);
  });
});
