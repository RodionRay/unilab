/**
 * Bulk VK account import: line parser and proxy assignment (spec vk-lead-source REQ-1,
 * REQ-1a, AM-10, AM-11). Pure: token validation (users.get) and storage live in the route.
 * Passwords and logins are dropped here and never leave this module.
 */

/** AM-10: the UI sends at most this many lines per request and loops. */
export const VK_IMPORT_CHUNK = 20;
export const VK_DEFAULT_ACCOUNTS_PER_PROXY = 3;

// Legacy tokens are 85 hex chars; current ones look like `vk1.a.<base64url>`.
const TOKEN_RE = /^[A-Za-z0-9._-]{32,1024}$/;

export type VkImportLine =
  | {line: number; ok: true; token: string; expiresIn: number | null; userId: number | null; warning?: string}
  | {line: number; ok: false; reason: string; duplicate?: true};

function parseOauthUrl(raw: string): {token: string; expiresIn: number | null; userId: number | null} | null {
  const at = raw.indexOf('#');
  const query = at >= 0 ? raw.slice(at + 1) : raw.slice(raw.indexOf('?') + 1);
  const params = new URLSearchParams(query);
  const token = params.get('access_token');
  if (!token) return null;
  const num = (key: string) => {
    const v = params.get(key);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  };
  return {token, expiresIn: num('expires_in'), userId: num('user_id')};
}

function tokenFromLine(raw: string): {token: string; expiresIn: number | null; userId: number | null} | string {
  if (raw.includes('access_token=')) return parseOauthUrl(raw) ?? 'В ссылке нет access_token';
  const parts = raw.split(':');
  if (parts.length === 2) return 'Ожидается token или login:password:token';
  // login:password:token — a password may itself hold ':', the token is always last.
  return {token: parts[parts.length - 1].trim(), expiresIn: null, userId: null};
}

/**
 * One result per non-empty line (`line` is 1-based in the pasted text). Repeated tokens in
 * the same paste are reported as duplicates; duplicates of stored accounts are found by
 * `vkUserId` after validation.
 */
export function parseVkAccountLines(text: string): VkImportLine[] {
  const seen = new Set<string>();
  const out: VkImportLine[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (raw) out.push(parseLine(raw, i + 1, seen));
  });
  return out;
}

function parseLine(raw: string, line: number, seen: Set<string>): VkImportLine {
  const parsed = tokenFromLine(raw);
  if (typeof parsed === 'string') return {line, ok: false, reason: parsed};
  if (!TOKEN_RE.test(parsed.token)) return {line, ok: false, reason: 'Токен не похож на токен VK'};
  if (seen.has(parsed.token)) return {line, ok: false, reason: 'Повтор в списке', duplicate: true};
  seen.add(parsed.token);
  // expires_in=0 means an offline (non-expiring) token; anything else will stop working.
  if (!parsed.expiresIn) return {line, ok: true, ...parsed};
  return {line, ok: true, ...parsed, warning: `Токен временный: истекает через ${parsed.expiresIn} с`};
}

/** Splits pasted text into request-sized chunks of non-empty lines (AM-10). */
export function chunkVkImportLines(text: string, size: number = VK_IMPORT_CHUNK): string[] {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size).join('\n'));
  return chunks;
}

export type ProxyRef = {id: string; data: {status?: string}};
export type ProxyUser = {kind: string; data: {proxyId?: unknown}};

/** AM-11: accounts per proxy, Telegram (`account`) and VK (`vk_account`) together. */
export function proxyLoad(records: readonly ProxyUser[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const r of records) {
    if (r.kind !== 'account' && r.kind !== 'vk_account') continue;
    const id = String(r.data.proxyId ?? '');
    if (id) load.set(id, (load.get(id) ?? 0) + 1);
  }
  return load;
}

/**
 * REQ-1a: a proxy id (or null = `no_proxy`) for each of `count` new accounts. With `chosenProxyId`
 * every account goes there while it has room; otherwise each goes to the least loaded active
 * proxy under `cap` (ties: list order), which spreads accounts round-robin.
 */
export function assignVkProxies(opts: {
  count: number;
  proxies: readonly ProxyRef[];
  load: ReadonlyMap<string, number>;
  cap?: number;
  chosenProxyId?: string;
}): (string | null)[] {
  const cap = opts.cap ?? VK_DEFAULT_ACCOUNTS_PER_PROXY;
  const active = opts.proxies.filter(
    (p) => p.data.status === 'active' && (!opts.chosenProxyId || p.id === opts.chosenProxyId),
  );
  const load = new Map(opts.load);
  const out: (string | null)[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    let best: ProxyRef | null = null;
    for (const p of active) {
      const used = load.get(p.id) ?? 0;
      if (used < cap && (best === null || used < (load.get(best.id) ?? 0))) best = p;
    }
    if (best) load.set(best.id, (load.get(best.id) ?? 0) + 1);
    out.push(best ? best.id : null);
  }
  return out;
}
