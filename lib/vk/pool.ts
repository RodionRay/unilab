/**
 * VK account pool: pick, lease, count and penalise accounts (spec vk-lead-source REQ-1b,
 * REQ-9, REQ-10, AM-8, AM-9). Pure functions over `vk_account.data`; the route persists
 * the returned data (and must write leases with a compare-and-swap on the old data).
 */
import {moscowDayKey} from '@/lib/telegram-accounts';
import type {VkErrorClass} from '@/lib/vk/client';

export const VK_SEARCH_METHOD = 'newsfeed.search';
export const VK_DEFAULT_SEARCH_DAILY_CAP = 500;
/** One scan of one source is capped at 60 s; the lease outlives it so a crash frees the account. */
export const VK_LEASE_TTL_MS = 120_000;

export type VkAccountStatus = 'active' | 'error' | 'cooldown' | 'no_proxy';

export type VkAccountData = {
  vkUserId: number;
  name: string;
  proxyId: string;
  status: VkAccountStatus;
  error?: string;
  cooldownUntil?: string;
  counters?: {day: string; calls: number; searchCalls: number};
  /** AM-8 error 29: per-method block until the next Moscow midnight. */
  searchBlockedUntil?: Record<string, string>;
  leaseId?: string;
  leaseUntil?: string;
};
export type VkAccountRow = {id: string; data: VkAccountData};
/** 0 = no cap (same convention as Telegram day limits). */
export type VkDailyCaps = {search: number; calls: number};
export const VK_DEFAULT_DAILY_CAPS: VkDailyCaps = {search: VK_DEFAULT_SEARCH_DAILY_CAP, calls: 0};

const isFuture = (iso: string | undefined, now: number) => Boolean(iso) && Date.parse(String(iso)) > now;

/** Today's counters; yesterday's (Moscow day) read as zero. */
export function vkUsageToday(data: VkAccountData, now: number = Date.now()): {calls: number; searchCalls: number} {
  const c = data.counters;
  if (!c || c.day !== moscowDayKey(new Date(now))) return {calls: 0, searchCalls: 0};
  return {calls: Math.max(0, Number(c.calls) || 0), searchCalls: Math.max(0, Number(c.searchCalls) || 0)};
}

/** Status as the pool sees it: an expired cooldown is active again. */
export function effectiveVkStatus(data: VkAccountData, now: number = Date.now()): VkAccountStatus {
  if (data.status === 'cooldown' && !isFuture(data.cooldownUntil, now)) return 'active';
  return data.status;
}

export function isVkLeased(data: VkAccountData, now: number = Date.now()): boolean {
  return Boolean(data.leaseId) && isFuture(data.leaseUntil, now);
}

function underCap(used: number, cap: number): boolean {
  return !(cap > 0) || used < cap;
}

/** Can this account run `method` now: active, has a proxy, not leased, not blocked, under caps. */
export function isVkAccountAvailable(
  data: VkAccountData,
  opts: {method: string; now?: number; caps?: VkDailyCaps},
): boolean {
  const now = opts.now ?? Date.now();
  const caps = opts.caps ?? VK_DEFAULT_DAILY_CAPS;
  if (effectiveVkStatus(data, now) !== 'active' || !data.proxyId) return false;
  if (isVkLeased(data, now) || isFuture(data.searchBlockedUntil?.[opts.method], now)) return false;
  const usage = vkUsageToday(data, now);
  if (!underCap(usage.calls, caps.calls)) return false;
  return opts.method !== VK_SEARCH_METHOD || underCap(usage.searchCalls, caps.search);
}

/** REQ-1b: the available account least used today (ties: id order, so picks are stable). */
export function pickVkAccount(
  accounts: readonly VkAccountRow[],
  opts: {method: string; now?: number; caps?: VkDailyCaps; exclude?: ReadonlySet<string>},
): VkAccountRow | null {
  const now = opts.now ?? Date.now();
  const usable = accounts.filter(
    (a) => !opts.exclude?.has(a.id) && isVkAccountAvailable(a.data, {...opts, now}),
  );
  usable.sort((a, b) => vkUsageToday(a.data, now).calls - vkUsageToday(b.data, now).calls || a.id.localeCompare(b.id));
  return usable[0] ?? null;
}

/** AM-9: one live scan per account. Returns null when someone else holds a live lease. */
export function leaseVkAccount(
  data: VkAccountData,
  opts: {leaseId: string; now?: number; ttlMs?: number},
): VkAccountData | null {
  const now = opts.now ?? Date.now();
  if (isVkLeased(data, now) && data.leaseId !== opts.leaseId) return null;
  return {...data, leaseId: opts.leaseId, leaseUntil: new Date(now + (opts.ttlMs ?? VK_LEASE_TTL_MS)).toISOString()};
}

/** Frees the lease only if `leaseId` still holds it (a stale run must not free a newer lease). */
export function releaseVkAccount(data: VkAccountData, leaseId: string): VkAccountData {
  if (data.leaseId !== leaseId) return data;
  const next = {...data};
  delete next.leaseId;
  delete next.leaseUntil;
  return next;
}

/** REQ-10: count `count` sent calls of `method` into today's counters. */
export function recordVkCalls(
  data: VkAccountData,
  opts: {method: string; count?: number; now?: number},
): VkAccountData {
  const now = opts.now ?? Date.now();
  const n = Math.max(0, opts.count ?? 1);
  const usage = vkUsageToday(data, now);
  return {
    ...data,
    counters: {
      day: moscowDayKey(new Date(now)),
      calls: usage.calls + n,
      searchCalls: usage.searchCalls + (opts.method === VK_SEARCH_METHOD ? n : 0),
    },
  };
}

/** AM-8: the account state after a classified error on `method`. retry/skip_item leave it as is. */
export function applyVkError(data: VkAccountData, cls: VkErrorClass, method: string): VkAccountData {
  switch (cls.kind) {
    case 'account_error':
      return {...data, status: 'error', error: `VK ${cls.code}: ${cls.reason}`};
    case 'cooldown':
      return {...data, status: 'cooldown', cooldownUntil: cls.until, error: `VK ${cls.code}: ${cls.reason}`};
    case 'method_blocked':
      return {...data, searchBlockedUntil: {...data.searchBlockedUntil, [method]: String(cls.until)}};
    case 'retry':
    case 'skip_item':
      return data;
  }
}
