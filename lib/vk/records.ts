/**
 * Storage of VK record kinds in `records` (spec vk-lead-source D2, AM-1, AM-4, AM-9):
 * `vk_account` (token sealed in `secret`) and `vk_source` (search / group, cursor state).
 * Every write here is a compare-and-swap or a single-field json_set, so a scan, a manual
 * action and the cron never overwrite each other's fields.
 */
import type {D1LikeDatabase} from '@/lib/db';
import {checkProxyTarget} from '@/lib/security/net-guard';
import {unseal} from '@/lib/server-store';
import type {VkProxy} from '@/lib/vk/client';
import type {VkAccountData} from '@/lib/vk/pool';
import {MAX_LEAD_TOMBSTONES} from '@/lib/processes/scan-flow';

export const VK_ACCOUNT_KIND = 'vk_account';
export const VK_SOURCE_KIND = 'vk_source';
/**
 * Owner-level holder of VK lead tombstones (AM-2) that outlives every vk_source: keys of deleted
 * leads whose source is gone. Server-only: never listed to the client, never saved generically.
 */
export const VK_TOMBSTONE_KIND = 'vk_tombstones';
/** One scan run is capped at 60 s; the lock outlives it (AI batches) and frees itself after a crash. */
export const VK_SOURCE_LOCK_TTL_MS = 5 * 60_000;

export type VkSourceType = 'search' | 'group';
/** Search interval still paging: its pinned end and next_from per unfinished keyword ('' = first page). */
export type VkSearchPaging = {endTime: number; next: Record<string, string>};
export type VkSourceCursor = {searchStartTime?: number; searchPaging?: VkSearchPaging; wallMaxPostId?: number; boardSince?: number};
export type VkSourceData = {
  type: VkSourceType;
  title: string;
  vkGroupId?: number;
  screenName?: string;
  url?: string;
  cursor: VkSourceCursor;
  lastScanAt: string;
  scanLockUntil?: string;
  scanLockToken?: string;
  error?: string;
  aiRejected?: unknown;
  leadTombstones?: string[];
  leadsTotal?: number;
  leadsHot?: number;
  leadsWarm?: number;
  leadsCold?: number;
  scanMatched?: number;
  scanLog?: {at: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string}[];
};

/** `raw` is the stored JSON text, the compare-and-swap token for writes. */
export type StoredVkAccount = {id: string; data: VkAccountData; raw: string; secret: string | null};
export type StoredVkSource = {id: string; data: VkSourceData; raw: string};

function parseJson<T>(raw: unknown): T | null {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function loadVkAccounts(db: D1LikeDatabase, owner: string): Promise<StoredVkAccount[]> {
  const rows = await db
    .prepare('SELECT id,data,secret FROM records WHERE owner=? AND kind=? ORDER BY created')
    .bind(owner, VK_ACCOUNT_KIND)
    .all();
  return rows.results.flatMap((r) => {
    const data = parseJson<VkAccountData>(r.data);
    if (!data) return [];
    return [{id: String(r.id), data, raw: String(r.data), secret: r.secret == null ? null : String(r.secret)}];
  });
}

export async function loadVkSources(db: D1LikeDatabase, owner: string): Promise<StoredVkSource[]> {
  const rows = await db.prepare('SELECT id,data FROM records WHERE owner=? AND kind=? ORDER BY created').bind(owner, VK_SOURCE_KIND).all();
  return rows.results.flatMap((r) => {
    const data = parseJson<VkSourceData>(r.data);
    return data ? [{id: String(r.id), data, raw: String(r.data)}] : [];
  });
}

export async function loadVkSource(db: D1LikeDatabase, owner: string, id: string): Promise<StoredVkSource | null> {
  const row = await db
    .prepare('SELECT id,data FROM records WHERE owner=? AND id=? AND kind=?')
    .bind(owner, id, VK_SOURCE_KIND)
    .first<{id: string; data: string}>();
  const data = row ? parseJson<VkSourceData>(row.data) : null;
  return row && data ? {id: String(row.id), data, raw: String(row.data)} : null;
}

/** Writes `data` only if the row still holds `raw`; false = someone else wrote first. */
export async function swapVkAccount(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  raw: string,
  data: VkAccountData,
): Promise<string | null> {
  const next = JSON.stringify(data);
  const res = await db
    .prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=? AND data=?')
    .bind(next, owner, id, VK_ACCOUNT_KIND, raw)
    .run();
  return res.meta.changes === 1 ? next : null;
}

/** Read-modify-write with retries; `fn` must be pure (it may run more than once). Null = row gone. */
export async function mutateVkAccount(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  fn: (data: VkAccountData) => VkAccountData,
): Promise<VkAccountData | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await db
      .prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?')
      .bind(owner, id, VK_ACCOUNT_KIND)
      .first<{data: string}>();
    const data = row ? parseJson<VkAccountData>(row.data) : null;
    if (!row || !data) return null;
    const next = fn(data);
    if (await swapVkAccount(db, owner, id, String(row.data), next)) return next;
  }
  throw new Error('vk_account: concurrent update conflict');
}

export async function acquireVkSourceLock(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  now: number = Date.now(),
): Promise<{token: string; until: string} | null> {
  const token = crypto.randomUUID();
  const until = new Date(now + VK_SOURCE_LOCK_TTL_MS).toISOString();
  const res = await db
    .prepare(
      "UPDATE records SET data=json_set(data,'$.scanLockUntil',?,'$.scanLockToken',?) WHERE owner=? AND id=? AND kind=? AND COALESCE(json_extract(data,'$.scanLockUntil'),'')<?",
    )
    .bind(until, token, owner, id, VK_SOURCE_KIND, new Date(now).toISOString())
    .run();
  return res.meta.changes === 1 ? {token, until} : null;
}

export async function releaseVkSourceLock(db: D1LikeDatabase, owner: string, id: string, token: string): Promise<void> {
  await db
    .prepare(
      "UPDATE records SET data=json_set(data,'$.scanLockUntil','','$.scanLockToken','') WHERE owner=? AND id=? AND kind=? AND json_extract(data,'$.scanLockToken')=?",
    )
    .bind(owner, id, VK_SOURCE_KIND, token)
    .run();
}

/**
 * AM-1: a lead id derived from owner + D4 key, shaped as a UUID (version 5 nibble, RFC variant)
 * so `INSERT OR IGNORE` makes a second insert of one VK item a no-op, even from a parallel run.
 */
export async function vkLeadId(owner: string, msgKey: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${owner}\u0000${msgKey}`)));
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Same derivation for singleton records (the search source, one row per VK group). */
export const vkRecordId = vkLeadId;

const tombstoneHolderId = (owner: string): Promise<string> => vkRecordId(owner, 'vk-tombstones');

export async function loadVkTombstones(db: D1LikeDatabase, owner: string): Promise<string[]> {
  const row = await db
    .prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?')
    .bind(owner, await tombstoneHolderId(owner), VK_TOMBSTONE_KIND)
    .first<{data: string}>();
  return row ? tombstonesOf(row.data) : [];
}

function tombstonesOf(raw: unknown): string[] {
  const list = parseJson<{leadTombstones?: unknown}>(raw)?.leadTombstones;
  return Array.isArray(list) ? list.map(String) : [];
}

/** Adds keys to the owner-level holder (created on first use); compare-and-swap, parallel adds all land. */
export async function addVkTombstones(db: D1LikeDatabase, owner: string, keys: readonly string[]): Promise<void> {
  const fresh = keys.filter(Boolean);
  if (!fresh.length) return;
  const id = await tombstoneHolderId(owner);
  await db
    .prepare('INSERT OR IGNORE INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .bind(id, owner, VK_TOMBSTONE_KIND, JSON.stringify({leadTombstones: []}), null, new Date().toISOString())
    .run();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await db.prepare('SELECT data FROM records WHERE owner=? AND id=? AND kind=?').bind(owner, id, VK_TOMBSTONE_KIND).first<{data: string}>();
    if (!row) return;
    const merged = [...new Set([...tombstonesOf(row.data), ...fresh])].slice(-MAX_LEAD_TOMBSTONES);
    const res = await db
      .prepare('UPDATE records SET data=? WHERE owner=? AND id=? AND kind=? AND data=?')
      .bind(JSON.stringify({leadTombstones: merged}), owner, id, VK_TOMBSTONE_KIND, String(row.data))
      .run();
    if (res.meta.changes === 1) return;
  }
  throw new Error('vk tombstones: concurrent update conflict');
}

/** Short non-reversible token fingerprint: finds a re-pasted token before it is validated. */
export async function vkTokenFingerprint(owner: string, token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`vk-token\u0000${owner}\u0000${token}`)));
  return Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type VkProxyLookup = {ok: true; proxy: VkProxy} | {ok: false; reason: string};

/** The proxy the worker dials for this account; never a private/loopback target (SSRF guard). */
export async function loadVkProxy(db: D1LikeDatabase, owner: string, proxyId: string): Promise<VkProxyLookup> {
  if (!proxyId) return {ok: false, reason: 'Нет прокси'};
  const row = await db
    .prepare('SELECT data,secret FROM records WHERE owner=? AND id=? AND kind=?')
    .bind(owner, proxyId, 'proxy')
    .first<{data: string; secret: string | null}>();
  const data = row ? parseJson<{host?: unknown; port?: unknown; protocol?: unknown; username?: unknown}>(row.data) : null;
  if (!row || !data) return {ok: false, reason: 'Прокси не найден'};
  const host = String(data.host ?? '');
  const port = Number(data.port);
  const target = checkProxyTarget(host, port);
  if (!target.ok) return {ok: false, reason: target.reason};
  let password = '';
  if (row.secret) {
    try {
      password = await unseal(row.secret, owner);
    } catch {
      return {ok: false, reason: 'Не удалось расшифровать пароль прокси'};
    }
  }
  const protocol = data.protocol === 'http' ? 'http' : 'socks5';
  return {ok: true, proxy: {host, port, protocol, username: String(data.username ?? ''), password}};
}
