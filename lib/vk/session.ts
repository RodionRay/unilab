/**
 * One run of VK calls on the owner's account pool (spec vk-lead-source REQ-1b, REQ-2, REQ-9,
 * REQ-10, AM-8, AM-9): lease the least used account, send batches through the worker, count
 * calls, keep each account within its daily newsfeed.search cap, apply the error policy to the account and fail over to the next account within the run.
 * The token is unsealed only for the leased account and never leaves this module except in the
 * worker request body.
 */
import type {D1LikeDatabase} from '@/lib/db';
import {unseal} from '@/lib/server-store';
import {
  VK_CODE_DEADLINE,
  VK_MAX_BATCH,
  classifyVkError,
  runVkBatch,
  shouldFailOver,
  type VkCall,
  type VkErrorClass,
  type VkProxy,
  type VkResult,
  type WorkerPost,
} from '@/lib/vk/client';
import {
  VK_SEARCH_METHOD,
  applyVkError,
  effectiveVkStatus,
  leaseVkAccount,
  pickVkAccount,
  recordVkCalls,
  releaseVkAccount,
  type VkAccountData,
  type VkDailyCaps,
  vkUsageToday,
} from '@/lib/vk/pool';
import {loadVkAccounts, loadVkProxy, mutateVkAccount, swapVkAccount, type StoredVkAccount} from '@/lib/vk/records';

/** REQ-1b: accounts tried per run before the run gives up on the remaining calls. */
export const VK_MAX_ACCOUNTS_PER_RUN = 3;
/** Pool exhausted: no account could take the calls (all busy, cooling, dead or without proxy). */
export const VK_CODE_NO_ACCOUNT = -10;

/** `searchCalls`: today's newsfeed.search count (persisted counter + this run), re-read after every batch. */
type Leased = {id: string; leaseId: string; token: string; proxy: VkProxy; searchCalls: number};

export type VkSessionStats = {accountsUsed: string[]; failovers: number; noAccount: boolean; outOfTime: boolean; lastError: string};

export type VkSession = {
  /** One result per call, in order. Calls the pool could not serve end as errors. */
  run(calls: readonly VkCall[]): Promise<VkResult[]>;
  /** Releases the current lease; call in `finally`. */
  close(): Promise<void>;
  readonly stats: VkSessionStats;
};

export type VkSessionOptions = {
  db: D1LikeDatabase;
  owner: string;
  post: WorkerPost;
  caps: VkDailyCaps;
  /** Epoch ms after which no new batch is sent (the scan's 60 s budget). */
  deadlineAt: number;
  now?: () => number;
};

/** The strictest method among pending calls decides which accounts qualify. */
function poolMethod(calls: readonly VkCall[]): string {
  return calls.some((c) => c.method === VK_SEARCH_METHOD) ? VK_SEARCH_METHOD : String(calls[0]?.method ?? '');
}

/**
 * REQ-10: splits a slice into calls the account may send and search calls past its daily cap,
 * so a run never pushes the account's newsfeed.search counter above the cap.
 */
function withinSearchCap(slice: readonly number[], calls: readonly VkCall[], left: number): {send: number[]; over: number[]} {
  const send: number[] = [];
  const over: number[] = [];
  let room = left;
  for (const i of slice) {
    if (calls[i].method !== VK_SEARCH_METHOD) send.push(i);
    else if (room > 0) {
      send.push(i);
      room -= 1;
    } else over.push(i);
  }
  return {send, over};
}

function countByMethod(calls: readonly VkCall[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.method, (counts.get(c.method) ?? 0) + 1);
  return counts;
}

/** Account state after one batch: counters for every sent call, then each failover-worthy error. */
function afterBatch(data: VkAccountData, sent: readonly VkCall[], errors: readonly {cls: VkErrorClass; method: string}[], now: number): VkAccountData {
  let next = data;
  for (const [method, count] of countByMethod(sent)) next = recordVkCalls(next, {method, count, now});
  for (const e of errors) next = applyVkError(next, e.cls, e.method);
  return next;
}

export async function openVkSession(opts: VkSessionOptions): Promise<VkSession> {
  const now = opts.now ?? Date.now;
  const pool: StoredVkAccount[] = await loadVkAccounts(opts.db, opts.owner);
  const tried = new Set<string>();
  const stats: VkSessionStats = {accountsUsed: [], failovers: 0, noAccount: false, outOfTime: false, lastError: ''};
  let current: Leased | null = null;

  async function lease(row: StoredVkAccount): Promise<Leased | null> {
    const leaseId = crypto.randomUUID();
    const leased = leaseVkAccount(row.data, {leaseId, now: now()});
    if (!leased || !(await swapVkAccount(opts.db, opts.owner, row.id, row.raw, leased))) return null;
    const proxy = await loadVkProxy(opts.db, opts.owner, row.data.proxyId);
    let token = '';
    try {
      token = row.secret ? await unseal(row.secret, opts.owner) : '';
    } catch {
      token = '';
    }
    if (proxy.ok && token) return {id: row.id, leaseId, token, proxy: proxy.proxy, searchCalls: vkUsageToday(leased, now()).searchCalls};
    // Proxy gone/unsafe → the account cannot run (A-7: no proxy rotation); a broken secret is an account error.
    await mutateVkAccount(opts.db, opts.owner, row.id, (d) => {
      const freed = releaseVkAccount(d, leaseId);
      return proxy.ok ? {...freed, status: 'error', error: 'Не удалось расшифровать токен'} : {...freed, status: 'no_proxy', error: proxy.reason};
    });
    return null;
  }

  async function acquire(method: string): Promise<Leased | null> {
    while (tried.size < VK_MAX_ACCOUNTS_PER_RUN) {
      const picked = pickVkAccount(pool, {method, now: now(), caps: opts.caps, exclude: tried});
      const row = picked && pool.find((a) => a.id === picked.id);
      if (!row) return null;
      tried.add(row.id);
      const leased = await lease(row);
      if (leased) {
        stats.accountsUsed.push(row.id);
        return leased;
      }
    }
    return null;
  }

  async function release(acc: Leased): Promise<void> {
    await mutateVkAccount(opts.db, opts.owner, acc.id, (d) => releaseVkAccount(d, acc.leaseId));
  }

  async function sendOnce(acc: Leased, calls: readonly VkCall[]): Promise<{results: VkResult[]; failed: boolean}> {
    const left = opts.deadlineAt - now();
    const post: WorkerPost = (path, body, ms) => opts.post(path, body, Math.max(5_000, Math.min(ms, left + 15_000)));
    const results = await runVkBatch(post, {token: acc.token, proxy: acc.proxy, calls});
    const errors: {cls: VkErrorClass; method: string}[] = [];
    results.forEach((r, i) => {
      if (r.ok) return;
      const cls = classifyVkError(r.error, now());
      if (shouldFailOver(cls)) errors.push({cls, method: calls[i].method});
    });
    if (errors.length) stats.lastError = `VK ${errors[0].cls.code}: ${errors[0].cls.reason}`;
    const saved = await mutateVkAccount(opts.db, opts.owner, acc.id, (d) => afterBatch(d, calls, errors, now()));
    const sentSearch = calls.filter((c) => c.method === VK_SEARCH_METHOD).length;
    acc.searchCalls = Math.max(acc.searchCalls + sentSearch, saved ? vkUsageToday(saved, now()).searchCalls : 0);
    return {results, failed: errors.length > 0};
  }

  /** Search calls the account may still send today; a cap ≤ 0 means no cap. */
  function searchLeft(acc: Leased): number {
    return opts.caps.search > 0 ? opts.caps.search - acc.searchCalls : Number.POSITIVE_INFINITY;
  }

  async function run(calls: readonly VkCall[]): Promise<VkResult[]> {
    const results: VkResult[] = calls.map(() => ({ok: false, error: {code: VK_CODE_DEADLINE, msg: 'not sent'}}));
    const sentOnce = new Set<number>();
    let pending = calls.map((_, i) => i);
    while (pending.length) {
      if (now() >= opts.deadlineAt) {
        stats.outOfTime = true;
        break;
      }
      current = current ?? (await acquire(poolMethod(pending.map((i) => calls[i]))));
      if (!current) {
        stats.noAccount = true;
        // A call some account already answered keeps that real error (e.g. 29) for the caller.
        for (const i of pending) {
          if (!sentOnce.has(i)) results[i] = {ok: false, error: {code: VK_CODE_NO_ACCOUNT, msg: 'no VK account available'}};
        }
        break;
      }
      const next: number[] = [];
      for (let at = 0; at < pending.length; at += VK_MAX_BATCH) {
        const {send: slice, over} = withinSearchCap(pending.slice(at, at + VK_MAX_BATCH), calls, searchLeft(current));
        next.push(...over);
        if (!slice.length) continue;
        const sent = await sendOnce(current, slice.map((i) => calls[i]));
        sent.results.forEach((r, k) => {
          results[slice[k]] = r;
          sentOnce.add(slice[k]);
          if (!r.ok && shouldFailOver(classifyVkError(r.error, now()))) next.push(slice[k]);
        });
        if (sent.failed) {
          next.push(...pending.slice(at + VK_MAX_BATCH));
          break;
        }
      }
      if (next.length) {
        await release(current);
        current = null;
        stats.failovers += 1;
      }
      pending = next;
    }
    return results;
  }

  return {
    run,
    async close() {
      if (current) await release(current);
      current = null;
    },
    stats,
  };
}

/** True when the owner has no account that could ever serve a scan (REQ-2: scans stop). */
export function noUsableVkAccount(accounts: readonly {data: VkAccountData}[], now: number = Date.now()): boolean {
  return !accounts.some((a) => {
    const st = effectiveVkStatus(a.data, now);
    return (st === 'active' || st === 'cooldown') && Boolean(a.data.proxyId);
  });
}
