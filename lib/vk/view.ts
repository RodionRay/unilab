/**
 * Client-side view rules for VK in the workspace UI (spec vk-lead-source REQ-11, REQ-12):
 * lead platform + filters, the only safe deep link, import chunking with original line numbers,
 * and how a `vk_account` row reads (status, reason, today's usage). Pure and browser-safe.
 */
import {VK_CODE_PROXY, classifyVkError} from '@/lib/vk/client';
import {VK_IMPORT_CHUNK} from '@/lib/vk/import';
import {VK_LEAD_URL} from '@/lib/vk/url';
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

/**
 * Security (review blocker): a lead URL becomes an href only when it matches the server's single
 * deep-link shape lib/vk/url.ts::VK_LEAD_URL (`https://vk.com/` + plain path/query); else null.
 */
export function safeVkHref(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048 || !VK_LEAD_URL.test(url)) return null;
  return url;
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
  /** Why it is not active, or until when it rests (Russian, actionable); '' when active and unblocked. */
  detail: string;
  /** The stored server error (with the VK code) for the title attribute only. */
  detailRaw: string;
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

/** Russian plural: pluralRu(3, ['аккаунт', 'аккаунта', 'аккаунтов']) → 'аккаунта'. */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Moscow wall-clock HH:MM — VK limits and counters live on Moscow days (lib/telegram-accounts::moscowDayKey). */
function moscowClock(iso: string | undefined): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'}) + ' МСК';
}

const CLOSED_CODES = new Set([15, 30, 203, 212]);
const ACCOUNT_DEAD_CODES = new Set([17, 18]);
const KNOWN_CODES = [5, 9, 14, 15, 17, 18, 29, 30, 203, 212, VK_CODE_PROXY];
/** Server reasons stored without the «VK <code>:» prefix (lib/vk/fetch.ts::skipReason) map back to their code. */
const CODE_BY_REASON: ReadonlyArray<[string, number]> = KNOWN_CODES
  .map((code): [string, number] => [classifyVkError({code, msg: ''}).reason, code])
  .sort((a, b) => b[0].length - a[0].length);

/** Server strings of lib/vk/import.ts, lib/processes/vk-accounts.ts and lib/processes/vk-scan.ts without a VK code. */
const NO_PROXY_RE = /нет свободного активного прокси/i;
const NO_KEYWORDS_RE = /ключев(?:ые|ых) слов/i;
const NO_ACCOUNT_RE = /нет (?:активного|свободного) vk-аккаунта/i;
/** lib/vk/import.ts::parseLine format reasons (English field names) → one Russian sentence. */
const BAD_LINE_RE = /^Ожидается token|не похожа на токен VK|^Токен не похож на токен VK/i;
export const VK_BAD_LINE_TEXT = 'Не похоже на аккаунт VK: нужен токен (vk1.a…) или логин:пароль:токен';

export type VkErrorView = {
  /** Russian, says what happened and what to do; the raw server string never shows here. */
  text: string;
  /** The VK error code when one was recognised (title/tooltips only). */
  code: number | null;
  /** The stored server string, for the title attribute. */
  raw: string;
};

export function vkErrorCode(raw: string): number | null {
  const m = /\bVK\s+(-?\d+)\b/.exec(raw);
  if (m) return Number(m[1]);
  const hit = CODE_BY_REASON.find(([reason]) => reason && raw.includes(reason));
  return hit ? hit[1] : null;
}

/**
 * VK error → actionable Russian text (panel fix 3). `until` is the account cooldown end,
 * `perProxyCap` the accounts-per-proxy setting for the no-proxy hint.
 */
export function vkErrorView(raw: unknown, opts: {until?: string; perProxyCap?: number} = {}): VkErrorView {
  const str = String(raw ?? '').trim();
  if (!str) return {text: '', code: null, raw: ''};
  const code = vkErrorCode(str);
  const until = moscowClock(opts.until);
  const cap = opts.perProxyCap && opts.perProxyCap > 0 ? opts.perProxyCap : 3;
  const view = (text: string): VkErrorView => ({text, code, raw: str});
  if (code === 5) return view('Токен недействителен: вставьте новый');
  if (code === 9) return view(until ? `VK ограничил частоту, пауза до ${until}` : 'VK ограничил частоту, аккаунт на паузе');
  if (code === 14) return view(until ? `VK запросил капчу, пауза до ${until}` : 'VK запросил капчу, аккаунт на паузе');
  if (code !== null && ACCOUNT_DEAD_CODES.has(code)) return view('Аккаунт заблокирован или требует проверки. Войдите в VK и пройдите проверку');
  if (code === 29) return view('Дневной лимит поиска исчерпан до 00:00 МСК');
  if (code === VK_CODE_PROXY) return view('Прокси не отвечает, выберите другой');
  if (code !== null && CLOSED_CODES.has(code)) {
    return view('Сообщество закрыто: аккаунт не видит стену. Вступите в него с VK-аккаунта или удалите источник');
  }
  if (NO_PROXY_RE.test(str)) {
    return view(`Все прокси заняты (по ${cap} ${pluralRu(cap, ['аккаунту', 'аккаунта', 'аккаунтов'])}). Добавьте прокси в разделе «Прокси»`);
  }
  if (BAD_LINE_RE.test(str)) return view(VK_BAD_LINE_TEXT);
  if (NO_KEYWORDS_RE.test(str)) return view('Нет ключевых слов. Добавьте их в настройках AI');
  if (NO_ACCOUNT_RE.test(str)) return view('Нет VK-аккаунта, который может сканировать. Привяжите прокси в «Аккаунтах»');
  if (code !== null && (code < 0 || code === 1 || code === 6 || code === 10)) return view('VK не ответил вовремя, повторим при следующем обходе');
  // Unknown: drop the technical prefix, keep the server's own words.
  return view(str.replace(/^(?:Токен не принят|Не удалось проверить):\s*/, '').replace(/\bVK\s+-?\d+:?\s*/, '').trim() || str);
}

export function vkAccountView(data: VkAccountData, opts: {now?: number; searchCap?: unknown; perProxyCap?: number} = {}): VkAccountView {
  const now = opts.now ?? Date.now();
  const status = effectiveVkStatus(data, now);
  const base = STATUS_VIEW[status] ?? STATUS_VIEW.error;
  const usage = vkUsageToday(data, now);
  const cap = Number(opts.searchCap);
  const searchCap = Number.isInteger(cap) && cap >= 0 ? cap : VK_DEFAULT_SEARCH_DAILY_CAP;
  const err = vkErrorView(data.error, {until: data.cooldownUntil, perProxyCap: opts.perProxyCap});
  let detail = err.text;
  if (status === 'cooldown' && !detail) {
    const mins = minutesLeft(data.cooldownUntil, now);
    detail = mins ? `Пауза, ${restLabel(mins)}` : '';
  } else if (status === 'active') {
    const blocked = Object.values(data.searchBlockedUntil ?? {}).some((iso) => minutesLeft(iso, now) > 0);
    detail = blocked ? 'Дневной лимит поиска исчерпан до 00:00 МСК' : '';
  }
  return {status, tone: base.tone, label: base.label, detail, detailRaw: status === 'active' ? '' : err.raw, calls: usage.calls, searchCalls: usage.searchCalls, searchCap};
}

export type VkStatusFilter = 'all' | VkAccountData['status'];

export function countVkStatuses(views: readonly {view: {status: VkAccountData['status']}}[]): Record<VkStatusFilter, number> {
  const out: Record<VkStatusFilter, number> = {all: views.length, active: 0, cooldown: 0, error: 0, no_proxy: 0};
  for (const v of views) out[v.view.status] += 1;
  return out;
}

/** «Проверено N строк: добавлено A, дубликатов D, ошибок E» (+ без прокси when any). */
export function vkImportHeadline(results: readonly VkImportLineResult[]): string {
  const t = tallyVkImport(results);
  const n = results.length;
  const verb = pluralRu(n, ['Проверена', 'Проверены', 'Проверено']);
  const parts = [`добавлено ${t.added}`];
  if (t.no_proxy) parts.push(`без прокси ${t.no_proxy}`);
  parts.push(`дубликатов ${t.duplicate}`, `ошибок ${t.invalid}`);
  return `${verb} ${n} ${pluralRu(n, ['строка', 'строки', 'строк'])}: ${parts.join(', ')}`;
}

/**
 * After a partial import the textarea keeps only the lines to fix, in paste order (panel fix 6).
 * Only `invalid` lines: `no_proxy` lines are already saved (a re-paste reads as a duplicate) and get a proxy in the list.
 */
export function vkLinesToRetry(text: string, results: readonly VkImportLineResult[]): string {
  const failed = new Set(results.filter((r) => r.status === 'invalid').map((r) => r.line));
  return text
    .split(/\r?\n/)
    .filter((_, i) => failed.has(i + 1))
    .map((l) => l.trim())
    .join('\n');
}

/**
 * Bulk «Привязать прокси: авто» (panel fix 7): the server binds one explicit proxy per call
 * (lib/processes/vk-accounts.ts::setVkAccountProxy, cap AM-11), so the UI spreads the selection over the
 * least-loaded active proxies under `cap`. An account already on an active proxy keeps it; null = no room.
 */
export function planVkAutoProxy(
  selectedIds: readonly string[],
  accounts: readonly {id: string; data: {proxyId?: string}}[],
  activeProxyIds: readonly string[],
  cap: number,
): Map<string, string | null> {
  const load = new Map(activeProxyIds.map((id) => [id, 0]));
  for (const a of accounts) {
    const p = a.data.proxyId || '';
    if (load.has(p)) load.set(p, (load.get(p) ?? 0) + 1);
  }
  const out = new Map<string, string | null>();
  for (const id of selectedIds) {
    const current = accounts.find((a) => a.id === id)?.data.proxyId || '';
    if (load.has(current)) {
      out.set(id, current);
      continue;
    }
    let best: string | null = null;
    for (const [pid, n] of load) if (n < cap && (best === null || n < (load.get(best) ?? 0))) best = pid;
    if (best !== null) load.set(best, (load.get(best) ?? 0) + 1);
    out.set(id, best);
  }
  return out;
}

/** Mirrors lib/vk/session.ts::noUsableVkAccount (server-only module): can any account scan at all. */
export function vkPoolCanScan(accounts: readonly {data: VkAccountData}[], now: number = Date.now()): boolean {
  return accounts.some((a) => {
    const st = effectiveVkStatus(a.data, now);
    return (st === 'active' || st === 'cooldown') && Boolean(a.data.proxyId);
  });
}

/** «Вызовов: 12, поисков: 3 из 500» — today's usage as one labelled line (no `A · B` meta string). */
export function vkUsageLine(view: Pick<VkAccountView, 'calls' | 'searchCalls' | 'searchCap'>): string {
  const search = view.searchCap > 0 ? `${view.searchCalls} из ${view.searchCap}` : `${view.searchCalls}, без лимита`;
  return `Вызовов: ${view.calls}, поисков: ${search}`;
}

/** «2 лида, из них 1 горячий» for a VK source row. */
export function vkSourceLeadsLine(total: number, hot: number): string {
  const n = Math.max(0, Math.trunc(total) || 0);
  const h = Math.max(0, Math.trunc(hot) || 0);
  const head = `${n} ${pluralRu(n, ['лид', 'лида', 'лидов'])}`;
  return h > 0 ? `${head}, из них ${h} ${pluralRu(h, ['горячий', 'горячих', 'горячих'])}` : head;
}

/** The page «Поиск по списку» also narrows VK rows: name, VK id (id123 / vk.com/id123) or proxy label. */
export function matchesVkAccountQuery(data: Pick<VkAccountData, 'name' | 'vkUserId'>, proxyLabel: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const id = data.vkUserId ? String(data.vkUserId) : '';
  const hay = [data.name || '', id, id ? `vk.com/id${id}` : '', proxyLabel].join('\n').toLowerCase();
  return hay.includes(q);
}

/** Rows that need a hand come first: error, then no proxy, then cooldown, then active; stable inside a group. */
const TRIAGE_ORDER: Record<VkAccountData['status'], number> = {error: 0, no_proxy: 1, cooldown: 2, active: 3};

export function sortVkAccountsForTriage<T extends {view: {status: VkAccountData['status']}}>(rows: readonly T[]): T[] {
  return rows
    .map((row, i) => ({row, i}))
    .sort((a, b) => TRIAGE_ORDER[a.row.view.status] - TRIAGE_ORDER[b.row.view.status] || a.i - b.i)
    .map((x) => x.row);
}

/** 50–200 accounts: render a page at a time, «Показать ещё» adds the next one. */
export const VK_ACCOUNTS_PAGE = 50;

export function vkAccountsPage<T>(rows: readonly T[], pages: number, size: number = VK_ACCOUNTS_PAGE): {shown: T[]; rest: number} {
  const limit = Math.max(1, pages) * size;
  return {shown: rows.slice(0, limit), rest: Math.max(0, rows.length - limit)};
}

/** Groups page lede in a workspace with VK (panel r2 fix 8): names both platforms. */
export const VK_GROUPS_LEDE = 'Лиды из чатов Telegram и сообществ VK: группы ищутся по темам под AI, сообщества VK добавляются по ссылке.';

/** Leads info note with VK in the workspace; with the VK filter it speaks about VK only (panel r2 fix 5). */
export function vkLeadsNote(filter: LeadPlatformFilter, minutes: number): string {
  if (filter === 'vk') return `Источники VK обходятся круглосуточно, каждые ${minutes} мин на источник. «Собрать лиды» запускает обход сейчас`;
  if (filter === 'telegram') return `Группы Telegram обходятся круглосуточно, каждые ${minutes} мин на группу. «Собрать лиды» запускает обход сейчас`;
  return `«Собрать лиды» обходит группы Telegram и источники VK сейчас. Автообход круглосуточно: каждые ${minutes} мин на группу Telegram и на источник VK`;
}
