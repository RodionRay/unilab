import { describe, expect, it } from "vitest";
import {
  CHANNELS_TOO_MUCH_PAUSE_MS,
  JOIN_DAILY_CAP_AGED,
  JOIN_ERROR_PAUSE_MS,
  JOIN_ERROR_STREAK_LIMIT,
  JOIN_GAP_AGED_SEC,
  JOIN_GAP_WARMUP_SEC,
  PROXY_JOIN_GAP_SEC,
  accountAgeDays,
  accountJoinBlock,
  accountJoinWaitSec,
  channelsTooMuchPatch,
  effectiveJoinCap,
  farmThroughput,
  floodMarginSec,
  joinErrorPatch,
  joinAttemptPatch,
  joinFloodPatch,
  joinSuccessPatch,
  nextJoinGapSec,
  planJoinFarm,
  warmupCap,
} from "@/lib/join-pacing";
import { joinWaitSec, moscowDayKey } from "@/lib/telegram-accounts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;
const active = { status: "active", limits: { invite: 40 } };

describe("daily caps and warm-up", () => {
  it("aged accounts are capped at 20 even when the configured limit is higher", () => {
    expect(effectiveJoinCap(active, 30)).toBe(JOIN_DAILY_CAP_AGED);
    expect(JOIN_DAILY_CAP_AGED).toBe(20);
  });

  it("a lower configured limit wins; 0 means «no own limit»", () => {
    expect(effectiveJoinCap({ limits: { invite: 8 } }, 30)).toBe(8);
    expect(effectiveJoinCap({ limits: { invite: 0 } }, 30)).toBe(20);
  });

  it("fresh accounts warm up: 5 → 10 → 15 → 20", () => {
    expect(warmupCap(0)).toBe(5);
    expect(warmupCap(2.9)).toBe(5);
    expect(warmupCap(3)).toBe(10);
    expect(warmupCap(8)).toBe(15);
    expect(warmupCap(14)).toBe(20);
    expect(accountAgeDays(iso(NOW - 2 * DAY), NOW)).toBeCloseTo(2);
    expect(accountAgeDays(undefined, NOW)).toBeGreaterThan(14);
  });

  it("an exhausted cap blocks joins until the Moscow day rolls over", () => {
    const day = moscowDayKey(new Date());
    expect(accountJoinBlock({ ...active, joinsDay: day, joinsToday: 5 }, 1)).toBe("cap");
    expect(accountJoinBlock({ ...active, joinsDay: "2000-01-01", joinsToday: 99 }, 1)).toBeNull();
  });
});

describe("gaps, jitter and FloodWait", () => {
  it("gap is randomized within minutes, longer during warm-up", () => {
    expect(nextJoinGapSec(30, () => 0)).toBe(JOIN_GAP_AGED_SEC[0]);
    expect(nextJoinGapSec(30, () => 0.999999)).toBe(JOIN_GAP_AGED_SEC[1]);
    expect(nextJoinGapSec(1, () => 0)).toBe(JOIN_GAP_WARMUP_SEC[0]);
    expect(JOIN_GAP_AGED_SEC[0]).toBeGreaterThanOrEqual(300);
    const seen = new Set(Array.from({ length: 20 }, (_, i) => nextJoinGapSec(30, () => i / 20)));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("success patch bumps the counter, sets the jittered next slot and resets the error streak", () => {
    const p = joinSuccessPatch({ ...active, joinErrStreak: 3 }, 30, NOW, () => 0.5);
    expect(p.joinsToday).toBe(1);
    expect(p.joinErrStreak).toBe(0);
    expect(Date.parse(p.joinNextAt!) - NOW).toBe(nextJoinGapSec(30, () => 0.5) * 1000);
  });

  it("FloodWait is respected to the second plus a margin", () => {
    expect(floodMarginSec(10)).toBe(30);
    expect(floodMarginSec(1000)).toBe(150);
    const p = joinFloodPatch(1000, NOW);
    expect(Date.parse(p.floodUntil!) - NOW).toBe(1150 * 1000);
    expect(accountJoinWaitSec({ ...active, ...p }, NOW)).toBe(1150);
    // Legacy helper sees the same timer (used by evaluateJoinGate).
    expect(joinWaitSec({ ...p }, NOW)).toBe(1150);
  });

  it("a failed attempt spends half a gap and marks the proxy busy, without counting in the daily cap", () => {
    const p = joinAttemptPatch(30, NOW, () => 0);
    expect(Date.parse(p.joinNextAt!) - NOW).toBe((JOIN_GAP_AGED_SEC[0] / 2) * 1000);
    expect(p.lastJoinAt).toBe(iso(NOW));
    expect(p).not.toHaveProperty("joinsToday");
  });

  it("legacy lastJoinAt still spaces joins when no jitter slot is stored", () => {
    expect(accountJoinWaitSec({ ...active, lastJoinAt: iso(NOW - 60_000) }, NOW)).toBe(180);
  });
});

describe("errors, spam signals and pauses", () => {
  it(`${JOIN_ERROR_STREAK_LIMIT} consecutive account errors pause joins for 6 h`, () => {
    let acc: Record<string, unknown> = { ...active };
    for (let i = 1; i < JOIN_ERROR_STREAK_LIMIT; i++) {
      const p = joinErrorPatch(acc, NOW);
      expect(p.paused).toBe(false);
      acc = { ...acc, ...p };
    }
    const last = joinErrorPatch(acc, NOW);
    expect(last.paused).toBe(true);
    expect(Date.parse(last.joinPausedUntil!) - NOW).toBe(JOIN_ERROR_PAUSE_MS);
  });

  it("CHANNELS_TOO_MUCH blocks the account for 7 days", () => {
    const p = channelsTooMuchPatch(NOW);
    expect(Date.parse(p.joinBlockedUntil!) - NOW).toBe(CHANNELS_TOO_MUCH_PAUSE_MS);
    expect(accountJoinBlock({ ...active, ...p }, 30, NOW + 1000)).toBe("blocked");
  });

  it("spamblock / frozen / blind accounts never join", () => {
    expect(accountJoinBlock({ status: "spamblock" }, 30, NOW)).toBe("unusable");
    expect(accountJoinBlock({ status: "frozen" }, 30, NOW)).toBe("unusable");
    expect(accountJoinBlock({ ...active, resolveBlindUntil: iso(NOW + 60_000) }, 30, NOW)).toBe("blind");
  });
});

describe("farm planning: parallel across accounts, serial per account and proxy", () => {
  const old = iso(NOW - 60 * DAY);

  it("one join at a time per proxy; other proxies stay ready", () => {
    const farm = planJoinFarm(
      [
        { id: "a", created: old, data: { ...active, proxyId: "p1", lastJoinAt: iso(NOW - 30_000), joinNextAt: iso(NOW - 1) } },
        { id: "b", created: old, data: { ...active, proxyId: "p1" } },
        { id: "c", created: old, data: { ...active, proxyId: "p2" } },
      ],
      { now: NOW },
    );
    const byId = Object.fromEntries(farm.map((c) => [c.id, c.waitSec]));
    expect(byId.c).toBe(0);
    expect(byId.b).toBe(PROXY_JOIN_GAP_SEC - 30);
    expect(farm[0]!.id).toBe("c");
  });

  it("a reservation on a proxy holds its siblings; excluded and blocked accounts drop out", () => {
    const farm = planJoinFarm(
      [
        { id: "a", created: old, data: { ...active, proxyId: "p1", joinReservedUntil: iso(NOW + 120_000) } },
        { id: "b", created: old, data: { ...active, proxyId: "p1" } },
        { id: "x", created: old, data: { status: "spamblock" } },
        { id: "y", created: old, data: { ...active } },
      ],
      { now: NOW, exclude: new Set(["y"]) },
    );
    expect(farm.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(farm.every((c) => c.waitSec >= 119)).toBe(true);
  });

  it("among ready accounts prefers more joins left, then lower load", () => {
    const day = moscowDayKey(new Date(NOW));
    const farm = planJoinFarm(
      [
        { id: "busy", created: old, load: 1, data: { ...active, joinsDay: day, joinsToday: 15 } },
        { id: "free", created: old, load: 9, data: { ...active } },
      ],
      { now: NOW },
    );
    expect(farm[0]!.id).toBe("free");
  });

  it("throughput reports joins today against today's total cap", () => {
    const t = farmThroughput(
      [
        { id: "a", created: old, data: { ...active } },
        { id: "n", created: iso(NOW - DAY), data: { ...active } },
        { id: "dead", created: old, data: { status: "frozen" } },
      ],
      NOW,
    );
    expect(t).toMatchObject({ capToday: 25, accounts: 2, readyNow: 2 });
  });
});
