/**
 * Client-side view rules for VK in the workspace UI (spec vk-lead-source REQ-11, REQ-12):
 * lead platform + filters, the only safe deep link, import chunking with original line numbers,
 * and how a `vk_account` row reads (status, reason, today's usage). Pure and browser-safe.
 */
import {VK_IMPORT_CHUNK} from '@/lib/vk/import';
import {VK_DEFAULT_SEARCH_DAILY_CAP, effectiveVkStatus, vkUsageToday, type VkAccountData} from '@/lib/vk/pool';

export type LeadPlatform = 'telegram' | 'vk';
export type LeadPlatformFilter = 'all' | LeadPlatform;

/** D2: a lead without `platform` is a Telegram lead (no data migration). */
export function leadPlatform(data: {platform?: unknown}): LeadPlatform {
  return data.platform === 'vk' ? 'vk' : 'telegram';
}

export function matchesLeadPlatform(data: {platform?: unknown}, filter: LeadPlatformFilter): boolean {
  return filter === 'all' || leadPlatform(data) === filter;
}

/** The leads source filter holds a Telegram group id or a VK source id; 'all' passes everything. */
export function matchesLeadSource(data: {groupId?: unknown; vkSourceId?: unknown}, sourceId: string): boolean {
  if (sourceId === 'all') return true;
  if (!sourceId) return false;
  return String(data.groupId ?? '') === sourceId || String(data.vkSourceId ?? '') === sourceId;
}

const VK_LINK_PREFIX = 'https://vk.com/';

/**
 * Security (review blocker): a lead URL becomes an href only when it is a plain `https://vk.com/…`
 * link; anything else (other hosts, `javascript:`, userinfo, whitespace or control characters) → null.
 */
export function safeVkHref(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(VK_LINK_PREFIX) || url.length > 2048) return null;
  if (/[\s\\\u0000-\u001f\u007f]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'vk.com' || parsed.port || parsed.username || parsed.password) return null;
  return parsed.href;
}

/** One import request: ≤ VK_IMPORT_CHUNK non-empty lines and their 1-based line numbers in the paste. */
export type VkImportChunk = {text: string; lines: number[]};

/** AM-10: the UI loops over chunks; `lines` maps the server's per-chunk line back to the paste. */
export function planVkImportChunks(text: string, size: number = VK_IMPORT_CHUNK): VkImportChunk[] {
  const rows = text
    .split(/\r?\n/)
    .map((raw, i) => ({raw: raw.trim(), line: i + 1}))
    .filter((r) => r.raw);
  const out: VkImportChunk[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    out.push({text: part.map((r) => r.raw).join('\n'), lines: part.map((r) => r.line)});
  }
  return out;
}

export type VkImportStatus = 'added' | 'duplicate' | 'invalid' | 'no_proxy';
export type VkImportLineResult = {line: number; status: VkImportStatus; reason?: string; warning?: string; name?: string};

/** Server results carry the line inside the chunk; rewrite to the line of the whole paste. */
export function remapChunkResults(chunk: VkImportChunk, results: readonly VkImportLineResult[]): VkImportLineResult[] {
  return results.map((r) => ({...r, line: chunk.lines[r.line - 1] ?? r.line}));
}

/** A failed request marks every line of its chunk invalid with the request error. */
export function failedChunkResults(chunk: VkImportChunk, reason: string): VkImportLineResult[] {
  return chunk.lines.map((line) => ({line, status: 'invalid' as const, reason}));
}

export function tallyVkImport(results: readonly VkImportLineResult[]): Record<VkImportStatus, number> {
  const t: Record<VkImportStatus, number> = {added: 0, duplicate: 0, invalid: 0, no_proxy: 0};
  for (const r of results) t[r.status] += 1;
  return t;
}

export type VkAccountTone = 'success' | 'warning' | 'danger';
export type VkAccountView = {
  status: VkAccountData['status'];
  tone: VkAccountTone;
  label: string;
  /** Why it is not active, or until when it rests; '' when active and unblocked. */
  detail: string;
  calls: number;
  searchCalls: number;
  searchCap: number;
};

const STATUS_VIEW: Record<VkAccountData['status'], {tone: VkAccountTone; label: string}> = {
  active: {tone: 'success', label: 'Активен'},
  cooldown: {tone: 'warning', label: 'Пауза'},
  error: {tone: 'danger', label: 'Ошибка'},
  no_proxy: {tone: 'warning', label: 'Нет прокси'},
};

function minutesLeft(iso: string | undefined, now: number): number {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) && t > now ? Math.max(1, Math.round((t - now) / 60_000)) : 0;
}

function restLabel(mins: number): string {
  if (mins < 60) return `ещё ${mins} мин`;
  const h = Math.round(mins / 60);
  return `ещё ${h} ч`;
}

export function vkAccountView(data: VkAccountData, opts: {now?: number; searchCap?: unknown} = {}): VkAccountView {
  const now = opts.now ?? Date.now();
  const status = effectiveVkStatus(data, now);
  const base = STATUS_VIEW[status] ?? STATUS_VIEW.error;
  const usage = vkUsageToday(data, now);
  const cap = Number(opts.searchCap);
  const searchCap = Number.isInteger(cap) && cap >= 0 ? cap : VK_DEFAULT_SEARCH_DAILY_CAP;
  let detail = String(data.error || '');
  if (status === 'cooldown') {
    const mins = minutesLeft(data.cooldownUntil, now);
    detail = [mins ? restLabel(mins) : '', detail].filter(Boolean).join(' · ');
  } else if (status === 'active') {
    const blocked = Object.values(data.searchBlockedUntil ?? {}).some((iso) => minutesLeft(iso, now) > 0);
    detail = blocked ? 'Поиск закрыт VK до полуночи МСК' : '';
  }
  return {status, tone: base.tone, label: base.label, detail, calls: usage.calls, searchCalls: usage.searchCalls, searchCap};
}

/** Mirrors lib/vk/session.ts::noUsableVkAccount (server-only module): can any account scan at all. */
export function vkPoolCanScan(accounts: readonly {data: VkAccountData}[], now: number = Date.now()): boolean {
  return accounts.some((a) => {
    const st = effectiveVkStatus(a.data, now);
    return (st === 'active' || st === 'cooldown') && Boolean(a.data.proxyId);
  });
}
