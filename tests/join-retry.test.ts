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
} from "@/lib/processes/join-flow";

const NOW = Date.parse("2026-09-30T12:00:00Z");
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

  it("keeps a blind account from joining for the cooldown window only", () => {
    const acc = accountBlindPatch(NOW);
    expect(Date.parse(acc.resolveBlindUntil) - NOW).toBe(ACCOUNT_BLIND_COOLDOWN_MS);
    expect(isAccountResolveBlind(acc, NOW)).toBe(true);
    expect(isAccountResolveBlind(acc, NOW + ACCOUNT_BLIND_COOLDOWN_MS)).toBe(false);
    expect(isAccountResolveBlind({}, NOW)).toBe(false);
    expect(isAccountResolveBlind({ resolveBlindUntil: "garbage" }, NOW)).toBe(false);
  });
});
