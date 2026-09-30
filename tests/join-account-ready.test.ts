import { describe, expect, it } from "vitest";
import {
  accountBlindPatch,
  evaluateAccountJoinReadiness,
  evaluateJoinGate,
  isJoinFarmCandidate,
} from "@/lib/processes/join-flow";
import { joinWaitSec, withDayLimitCooldown } from "@/lib/telegram-accounts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const ready = { status: "active", limits: { invite: 40 } };

describe("готовность аккаунта к вступлению · evaluateAccountJoinReadiness", () => {
  it("пускает активный аккаунт с квотой, без прокси или с живым прокси", () => {
    expect(evaluateAccountJoinReadiness(ready, { now: NOW })).toEqual({ ok: true });
    expect(
      evaluateAccountJoinReadiness({ ...ready, proxyId: "p1" }, { proxy: { status: "active" }, now: NOW }),
    ).toEqual({ ok: true });
  });

  it("не берёт аккаунт, который не резолвит @username", () => {
    const blind = { ...ready, ...accountBlindPatch(NOW) };
    expect(evaluateAccountJoinReadiness(blind, { now: NOW + 60_000 })).toMatchObject({
      ok: false,
      reason: "resolve_blind",
    });
  });

  it("не берёт аккаунт с мёртвым или удалённым прокси", () => {
    expect(
      evaluateAccountJoinReadiness({ ...ready, proxyId: "p1" }, { proxy: { status: "inactive" }, now: NOW }),
    ).toMatchObject({ ok: false, reason: "proxy" });
    expect(
      evaluateAccountJoinReadiness({ ...ready, proxyId: "p1" }, { proxy: null, now: NOW }),
    ).toMatchObject({ ok: false, reason: "proxy" });
  });

  it("не берёт отключённый / неавторизованный аккаунт", () => {
    for (const status of ["disconnected", "proxy_error", "unauthorized", "checking", "setup"]) {
      expect(evaluateAccountJoinReadiness({ ...ready, status }, { now: NOW })).toMatchObject({
        ok: false,
        reason: "unusable",
      });
    }
  });

  it("держит FloodWait дольше обычной паузы между вступлениями", () => {
    const acc = {
      ...ready,
      lastJoinAt: new Date(NOW - 10 * 60_000).toISOString(),
      joinFloodUntil: new Date(NOW + 3_000_000).toISOString(),
    };
    expect(joinWaitSec(acc, NOW)).toBe(3000);
    expect(evaluateAccountJoinReadiness(acc, { now: NOW })).toMatchObject({
      ok: false,
      reason: "pace",
      waitSec: 3000,
    });
  });

  it("в ферму берёт аккаунт на паузе, но не на отлёжке и не слепой", () => {
    const paced = { ...ready, lastJoinAt: new Date(NOW - 60_000).toISOString() };
    expect(isJoinFarmCandidate(paced, { now: NOW })).toBe(true);
    expect(isJoinFarmCandidate({ ...ready, ...accountBlindPatch(NOW) }, { now: NOW })).toBe(false);
    expect(isJoinFarmCandidate(withDayLimitCooldown({ ...ready }, "invite"), { now: NOW })).toBe(false);
  });

  it("evaluateJoinGate применяет то же правило к аккаунту группы", () => {
    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: { ...ready, ...accountBlindPatch() },
      }),
    ).toMatchObject({ ok: false, reason: "resolve_blind" });
  });
});
