/**
 * Safe-but-fast join pacing for the account farm (docs/join-pipeline.md §Pacing).
 *
 * Parallel across accounts, serial per account and per proxy. Every number below is a deliberate
 * choice for user sessions (not Bot API):
 * - aged account ≤ 20 joins/day (practice: 15–25 is the safe band; the configured `limits.invite`
 *   can only lower it);
 * - warm-up by days in the farm: < 3 d → 5, < 7 d → 10, < 14 d → 15;
 * - randomized gap 6–15 min between joins of one account (15–30 min during the first week) —
 *   minutes, never seconds, and never a fixed period Telegram could fingerprint;
 * - ≥ 90 s between joins through one proxy (one exit IP → one join at a time);
 * - FloodWait respected to the second + 15 % (min 30 s) margin; the account is paused, not the farm;
 * - PEER_FLOOD → spamblock 24 h; CHANNELS_TOO_MUCH → no joins for 7 days;
 * - 4 consecutive account-side errors → joins paused 6 h.
 */

import { isAccountResolveBlind } from "@/lib/processes/join-flow";
import { isAccountUsable, moscowDayKey, normalizeJoinsToday, type JoinPaceState } from "@/lib/telegram-accounts";

export const JOIN_DAILY_CAP_AGED = 20;
export const JOIN_WARMUP_CAPS: readonly { belowDays: number; cap: number }[] = [
  { belowDays: 3, cap: 5 },
  { belowDays: 7, cap: 10 },
  { belowDays: 14, cap: 15 },
];
export const JOIN_GAP_AGED_SEC: readonly [number, number] = [360, 900];
export const JOIN_GAP_WARMUP_SEC: readonly [number, number] = [900, 1800];
export const JOIN_WARMUP_GAP_BELOW_DAYS = 7;
export const PROXY_JOIN_GAP_SEC = 90;
export const FLOOD_MARGIN_MIN_SEC = 30;
export const FLOOD_MARGIN_RATIO = 0.15;
export const JOIN_ERROR_STREAK_LIMIT = 4;
export const JOIN_ERROR_PAUSE_MS = 6 * 60 * 60_000;
export const CHANNELS_TOO_MUCH_PAUSE_MS = 7 * 24 * 60 * 60_000;
/** A reserved account is not handed to a parallel join; longer than one worker join call. */
export const JOIN_RESERVE_MS = 3 * 60_000;
/** Legacy spacing when only lastJoinAt is known (records written before joinNextAt existed). */
export const JOIN_LEGACY_GAP_SEC = 240;

export type PacedAccount = JoinPaceState & {
  status?: string | null;
  cooldownUntil?: string | null;
  proxyId?: string;
  limits?: { invite?: unknown };
  resolveBlindUntil?: string | null;
  joinNextAt?: string;
  floodUntil?: string;
  /** FloodWait end recorded by the join-account-selection rule (dev); same meaning as floodUntil. */
  joinFloodUntil?: string;
  joinPausedUntil?: string;
  joinBlockedUntil?: string;
  joinBlockReason?: string;
  joinErrStreak?: number;
  joinReservedUntil?: string;
};

function ts(iso: unknown): number {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? t : 0;
}

export function accountAgeDays(createdIso: string | undefined, now = Date.now()): number {
  const t = ts(createdIso);
  if (!t) return 365;
  return Math.max(0, (now - t) / 86_400_000);
}

export function warmupCap(ageDays: number): number {
  for (const step of JOIN_WARMUP_CAPS) if (ageDays < step.belowDays) return step.cap;
  return JOIN_DAILY_CAP_AGED;
}

/** Joins allowed today: min(configured limit, warm-up cap, aged ceiling). 0 configured = no own limit. */
export function effectiveJoinCap(account: PacedAccount, ageDays: number): number {
  const configured = Number(account.limits?.invite);
  const own = Number.isFinite(configured) && configured > 0 ? configured : JOIN_DAILY_CAP_AGED;
  return Math.max(0, Math.min(own, warmupCap(ageDays), JOIN_DAILY_CAP_AGED));
}

export function joinsLeftToday(account: PacedAccount, ageDays: number): number {
  return Math.max(0, effectiveJoinCap(account, ageDays) - normalizeJoinsToday(account));
}

/** Randomized gap after a join; `rnd` injectable for tests. */
export function nextJoinGapSec(ageDays: number, rnd: () => number = Math.random): number {
  const [lo, hi] = ageDays < JOIN_WARMUP_GAP_BELOW_DAYS ? JOIN_GAP_WARMUP_SEC : JOIN_GAP_AGED_SEC;
  const r = Math.min(0.999999, Math.max(0, rnd()));
  return lo + Math.floor(r * (hi - lo + 1));
}

export function floodMarginSec(waitSec: number): number {
  return Math.max(FLOOD_MARGIN_MIN_SEC, Math.ceil(Math.max(0, waitSec) * FLOOD_MARGIN_RATIO));
}

/** Seconds until this account may join again (own timers only, proxy not included). */
export function accountJoinWaitSec(account: PacedAccount, now = Date.now()): number {
  const legacy = ts(account.lastJoinAt) ? ts(account.lastJoinAt) + JOIN_LEGACY_GAP_SEC * 1000 : 0;
  const until = Math.max(
    legacy,
    ts(account.joinNextAt),
    ts(account.floodUntil),
    ts(account.joinFloodUntil),
    ts(account.joinPausedUntil),
    ts(account.joinBlockedUntil),
    ts(account.joinReservedUntil),
  );
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export type JoinBlock = "unusable" | "blind" | "cap" | "blocked" | null;

/** Hard reasons an account cannot join at all right now (a wait is not a block). */
export function accountJoinBlock(account: PacedAccount, ageDays: number, now = Date.now()): JoinBlock {
  if (!isAccountUsable(account)) return "unusable";
  if (isAccountResolveBlind(account, now)) return "blind";
  if (ts(account.joinBlockedUntil) > now) return "blocked";
  if (joinsLeftToday(account, ageDays) <= 0) return "cap";
  return null;
}

/** blocked: excluded by a rule outside this module (e.g. the account's proxy is down). */
export type FarmAccount = { id: string; data: PacedAccount; created?: string; load?: number; blocked?: boolean };

export type FarmCandidate = {
  id: string;
  data: PacedAccount;
  ageDays: number;
  waitSec: number;
  left: number;
  load: number;
};

/**
 * Accounts that can take a join, soonest first. Proxy spacing: an account waits while another
 * account on the same proxy joined < PROXY_JOIN_GAP_SEC ago or holds a reservation.
 */
export function planJoinFarm(
  accounts: readonly FarmAccount[],
  opts: { now?: number; exclude?: ReadonlySet<string> } = {},
): FarmCandidate[] {
  const now = opts.now ?? Date.now();
  const proxyBusyUntil = new Map<string, number>();
  for (const a of accounts) {
    const proxy = String(a.data.proxyId || "");
    if (!proxy) continue;
    const busy = Math.max(
      ts(a.data.lastJoinAt) ? ts(a.data.lastJoinAt) + PROXY_JOIN_GAP_SEC * 1000 : 0,
      ts(a.data.joinReservedUntil),
    );
    if (busy > (proxyBusyUntil.get(proxy) || 0)) proxyBusyUntil.set(proxy, busy);
  }
  const out: FarmCandidate[] = [];
  for (const a of accounts) {
    if (opts.exclude?.has(a.id) || a.blocked) continue;
    const ageDays = accountAgeDays(a.created, now);
    if (accountJoinBlock(a.data, ageDays, now)) continue;
    const proxy = String(a.data.proxyId || "");
    const proxyUntil = proxy ? proxyBusyUntil.get(proxy) || 0 : 0;
    const proxyWait = proxyUntil > now ? Math.ceil((proxyUntil - now) / 1000) : 0;
    out.push({
      id: a.id,
      data: a.data,
      ageDays,
      waitSec: Math.max(accountJoinWaitSec(a.data, now), proxyWait),
      left: joinsLeftToday(a.data, ageDays),
      load: Number(a.load) || 0,
    });
  }
  // Soonest first; among ready ones spread load: more joins left today, fewer groups assigned.
  out.sort((x, y) => x.waitSec - y.waitSec || y.left - x.left || x.load - y.load);
  return out;
}

/** Account fields after a confirmed join. */
export function joinSuccessPatch(
  account: PacedAccount,
  ageDays: number,
  now = Date.now(),
  rnd: () => number = Math.random,
): Partial<PacedAccount> {
  const day = moscowDayKey(new Date(now));
  const prev = account.joinsDay === day ? Number(account.joinsToday) || 0 : 0;
  return {
    lastJoinAt: new Date(now).toISOString(),
    joinsDay: day,
    joinsToday: prev + 1,
    joinNextAt: new Date(now + nextJoinGapSec(ageDays, rnd) * 1000).toISOString(),
    joinErrStreak: 0,
    joinReservedUntil: "",
  };
}

/**
 * A join attempt that reached Telegram but failed (private, banned, dead link …) still spends the
 * account's rhythm: half a normal gap, and the proxy spacing via lastJoinAt. Not counted in the daily cap.
 */
export function joinAttemptPatch(
  ageDays: number,
  now = Date.now(),
  rnd: () => number = Math.random,
): Partial<PacedAccount> {
  return {
    lastJoinAt: new Date(now).toISOString(),
    joinNextAt: new Date(now + Math.floor(nextJoinGapSec(ageDays, rnd) / 2) * 1000).toISOString(),
    joinReservedUntil: "",
  };
}

/** FloodWait: pause exactly the demanded time plus margin; the account stays active. */
export function joinFloodPatch(waitSec: number, now = Date.now()): Partial<PacedAccount> & { error: string } {
  const sec = Math.max(1, Math.ceil(waitSec));
  const total = sec + floodMarginSec(sec);
  return {
    floodUntil: new Date(now + total * 1000).toISOString(),
    joinReservedUntil: "",
    error: `FloodWait ${sec} с — вступления с аккаунта на паузе ${Math.ceil(total / 60)} мин`,
  };
}

/** Account-side error: one more in the streak; at the limit joins pause for JOIN_ERROR_PAUSE_MS. */
export function joinErrorPatch(account: PacedAccount, now = Date.now()): Partial<PacedAccount> & { paused: boolean } {
  const streak = (Number(account.joinErrStreak) || 0) + 1;
  if (streak >= JOIN_ERROR_STREAK_LIMIT) {
    return {
      joinErrStreak: 0,
      joinPausedUntil: new Date(now + JOIN_ERROR_PAUSE_MS).toISOString(),
      joinReservedUntil: "",
      paused: true,
    };
  }
  return { joinErrStreak: streak, joinReservedUntil: "", paused: false };
}

export function channelsTooMuchPatch(now = Date.now()): Partial<PacedAccount> {
  return {
    joinBlockedUntil: new Date(now + CHANNELS_TOO_MUCH_PAUSE_MS).toISOString(),
    joinBlockReason: "CHANNELS_TOO_MUCH: аккаунт в 500 каналах/группах — выйдите из лишних",
    joinReservedUntil: "",
  };
}

export type FarmThroughput = {
  joinsToday: number;
  capToday: number;
  readyNow: number;
  accounts: number;
};

/** Farm-level numbers for the rescan log: joins done today vs today's total cap, accounts ready now. */
export function farmThroughput(accounts: readonly FarmAccount[], now = Date.now()): FarmThroughput {
  let joinsToday = 0;
  let capToday = 0;
  let accountsN = 0;
  for (const a of accounts) {
    if (!isAccountUsable(a.data)) continue;
    accountsN++;
    joinsToday += normalizeJoinsToday(a.data);
    capToday += effectiveJoinCap(a.data, accountAgeDays(a.created, now));
  }
  const readyNow = planJoinFarm(accounts, { now }).filter((c) => c.waitSec === 0).length;
  return { joinsToday, capToday, readyNow, accounts: accountsN };
}
