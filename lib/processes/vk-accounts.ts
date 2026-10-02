/**
 * VK account and source actions of app/api/workspace/route.ts (spec vk-lead-source REQ-1, REQ-1a,
 * REQ-4, REQ-12 server side, AM-4, AM-10, AM-11): bulk import with users.get through the bound
 * proxy, proxy rebinding, deletion, group sources by URL and the auto-created search source.
 * Tokens are sealed on arrival and never returned; passwords are dropped by lib/vk/import.ts.
 */
import type {D1LikeDatabase} from '@/lib/db';
import {seal, unseal} from '@/lib/server-store';
import {VK_CODE_NO_ACCOUNT, openVkSession} from '@/lib/vk/session';
import {
  classifyVkError,
  groupIdFromResolve,
  groupsFromGetById,
  runVkBatch,
  vkMethods,
  type VkResult,
  type WorkerPost,
} from '@/lib/vk/client';
import {
  VK_DEFAULT_ACCOUNTS_PER_PROXY,
  VK_IMPORT_CHUNK,
  assignVkProxies,
  parseVkAccountLines,
  proxyLoad,
  type ProxyRef,
} from '@/lib/vk/import';
import {moscowDayKey} from '@/lib/telegram-accounts';
import {VK_DEFAULT_DAILY_CAPS, type VkAccountData} from '@/lib/vk/pool';
import {
  VK_ACCOUNT_KIND,
  VK_SOURCE_KIND,
  addVkTombstones,
  loadVkAccounts,
  loadVkProxy,
  loadVkSources,
  mutateVkAccount,
  vkRecordId,
  vkTokenFingerprint,
  type VkSourceData,
} from '@/lib/vk/records';
import {canonicalVkGroupUrl, parseVkGroupUrl} from '@/lib/vk/url';
import type {VkActionResult} from '@/lib/processes/vk-scan';

export type VkAccountDeps = {db: D1LikeDatabase; owner: string; post: WorkerPost; settings: Record<string, unknown>};

export type VkImportStatus = 'added' | 'duplicate' | 'invalid' | 'no_proxy';
export type VkImportLineResult = {line: number; status: VkImportStatus; reason?: string; warning?: string; id?: string; name?: string};

const VALIDATE_CONCURRENCY = 4;
/** users.get must answer well inside one HTTP request of 20 lines. */
const VALIDATE_TIMEOUT_MS = 30_000;
const SEARCH_SOURCE_TITLE = 'Поиск VK по ключевым словам';

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): VkActionResult => ({status, body: {error, ...extra}});
const ok = (body: Record<string, unknown>): VkActionResult => ({status: 200, body: {ok: true, ...body}});

type Validated = {ok: true; vkUserId: number; name: string} | {ok: false; reason: string};

async function validateToken(deps: VkAccountDeps, token: string, proxyId: string): Promise<Validated> {
  const proxy = await loadVkProxy(deps.db, deps.owner, proxyId);
  if (!proxy.ok) return {ok: false, reason: proxy.reason};
  const post: WorkerPost = (path, body) => deps.post(path, body, VALIDATE_TIMEOUT_MS);
  const [res] = await runVkBatch(post, {token, proxy: proxy.proxy, calls: [vkMethods.usersGet()]});
  return userFrom(res);
}

function userFrom(res: VkResult): Validated {
  if (!res.ok) {
    const cls = classifyVkError(res.error);
    const prefix = cls.kind === 'account_error' ? 'Токен не принят' : 'Не удалось проверить';
    return {ok: false, reason: `${prefix}: VK ${cls.code} ${cls.reason}`};
  }
  const user = Array.isArray(res.response) ? (res.response[0] as {id?: unknown; first_name?: unknown; last_name?: unknown}) : null;
  const id = Number(user?.id);
  if (!user || !Number.isInteger(id) || id <= 0) return {ok: false, reason: 'VK не вернул пользователя'};
  const name = [user.first_name, user.last_name].filter(Boolean).map(String).join(' ').trim();
  return {ok: true, vkUserId: id, name: name || `id${id}`};
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return out;
}

async function loadProxyPlan(deps: VkAccountDeps): Promise<{proxies: ProxyRef[]; load: Map<string, number>}> {
  const rows = await deps.db
    .prepare("SELECT id,kind,data FROM records WHERE owner=? AND kind IN ('proxy','account','vk_account') ORDER BY created")
    .bind(deps.owner)
    .all();
  const parsed = rows.results.flatMap((r) => {
    try {
      return [{id: String(r.id), kind: String(r.kind), data: JSON.parse(String(r.data)) as Record<string, unknown>}];
    } catch {
      return [];
    }
  });
  return {
    proxies: parsed.filter((r) => r.kind === 'proxy').map((r) => ({id: r.id, data: {status: String(r.data.status ?? '')}})),
    load: proxyLoad(parsed.filter((r) => r.kind !== 'proxy').map((r) => ({kind: r.kind, data: {proxyId: r.data.proxyId}}))),
  };
}

function perProxyCap(settings: Record<string, unknown>): number {
  const n = Number(settings.vkAccountsPerProxy);
  return Number.isInteger(n) && n > 0 ? n : VK_DEFAULT_ACCOUNTS_PER_PROXY;
}

async function insertAccount(deps: VkAccountDeps, data: VkAccountData & Record<string, unknown>, token: string): Promise<string> {
  const id = crypto.randomUUID();
  await deps.db
    .prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .bind(id, deps.owner, VK_ACCOUNT_KIND, JSON.stringify(data), await seal(token, deps.owner), new Date().toISOString())
    .run();
  return id;
}

/** REQ-12: one search source appears with the first active account; deterministic id = no duplicates. */
export async function ensureVkSearchSource(db: D1LikeDatabase, owner: string): Promise<void> {
  const data: VkSourceData = {type: 'search', title: SEARCH_SOURCE_TITLE, cursor: {}, lastScanAt: '', error: '', leadTombstones: []};
  await db
    .prepare('INSERT OR IGNORE INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .bind(await vkRecordId(owner, 'vk-source:search'), owner, VK_SOURCE_KIND, JSON.stringify(data), null, new Date().toISOString())
    .run();
}

/** Action `vk_accounts_import`: ≤20 lines per request (AM-10), one result per non-empty line. */
export async function importVkAccounts(deps: VkAccountDeps, input: {text: unknown; proxyId?: unknown}): Promise<VkActionResult> {
  const text = typeof input.text === 'string' ? input.text : '';
  const lines = parseVkAccountLines(text);
  if (!lines.length) return fail(400, 'Вставьте хотя бы одну строку с токеном');
  if (lines.length > VK_IMPORT_CHUNK) return fail(413, `Не больше ${VK_IMPORT_CHUNK} строк за запрос`);
  const chosenProxyId = typeof input.proxyId === 'string' && input.proxyId ? input.proxyId : undefined;
  const existing = await loadVkAccounts(deps.db, deps.owner);
  const knownUsers = new Set(existing.map((a) => Number(a.data.vkUserId)).filter((n) => n > 0));
  const knownFps = new Set(existing.map((a) => String((a.data as {tokenFp?: unknown}).tokenFp ?? '')).filter(Boolean));
  const plan = await loadProxyPlan(deps);
  const results: VkImportLineResult[] = [];
  const toValidate: {line: number; token: string; fp: string; proxyId: string; warning?: string; expiresIn: number | null}[] = [];
  const pendingNoProxy: typeof toValidate = [];
  for (const l of lines) {
    if (!l.ok) {
      results.push({line: l.line, status: l.duplicate ? 'duplicate' : 'invalid', reason: l.reason});
      continue;
    }
    const fp = await vkTokenFingerprint(deps.owner, l.token);
    if (knownFps.has(fp) || (l.userId && knownUsers.has(l.userId))) {
      results.push({line: l.line, status: 'duplicate', reason: 'Аккаунт уже добавлен'});
      continue;
    }
    const [proxyId] = assignVkProxies({count: 1, proxies: plan.proxies, load: plan.load, cap: perProxyCap(deps.settings), chosenProxyId});
    const entry = {line: l.line, token: l.token, fp, proxyId: proxyId ?? '', warning: l.warning, expiresIn: l.expiresIn};
    if (proxyId) {
      plan.load.set(proxyId, (plan.load.get(proxyId) ?? 0) + 1);
      toValidate.push(entry);
    } else pendingNoProxy.push(entry);
  }
  const checked = await mapLimited(toValidate, VALIDATE_CONCURRENCY, (e) => validateToken(deps, e.token, e.proxyId));
  const day = moscowDayKey();
  let addedActive = 0;
  for (const [i, e] of toValidate.entries()) {
    const v = checked[i];
    if (!v.ok) {
      results.push({line: e.line, status: 'invalid', reason: v.reason});
      continue;
    }
    if (knownUsers.has(v.vkUserId)) {
      results.push({line: e.line, status: 'duplicate', reason: 'Аккаунт уже добавлен', name: v.name});
      continue;
    }
    knownUsers.add(v.vkUserId);
    const id = await insertAccount(deps, {
      vkUserId: v.vkUserId, name: v.name, proxyId: e.proxyId, status: 'active', error: '', tokenFp: e.fp,
      expiresIn: e.expiresIn ?? 0, counters: {day, calls: 1, searchCalls: 0},
    }, e.token);
    addedActive += 1;
    results.push({line: e.line, status: 'added', id, name: v.name, ...(e.warning ? {warning: e.warning} : {})});
  }
  for (const e of pendingNoProxy) {
    const id = await insertAccount(deps, {
      vkUserId: 0, name: 'Не проверен', proxyId: '', status: 'no_proxy', error: 'Нет свободного активного прокси', tokenFp: e.fp,
      expiresIn: e.expiresIn ?? 0, counters: {day, calls: 0, searchCalls: 0},
    }, e.token);
    results.push({line: e.line, status: 'no_proxy', id, reason: 'Нет свободного активного прокси — сохранён без проверки, привяжите прокси'});
  }
  if (addedActive) await ensureVkSearchSource(deps.db, deps.owner);
  results.sort((a, b) => a.line - b.line);
  return ok({results, added: results.filter((r) => r.status === 'added' || r.status === 'no_proxy').length});
}

function readIds(input: {id?: unknown; ids?: unknown}): string[] | null {
  const raw = Array.isArray(input.ids) ? input.ids : input.id !== undefined ? [input.id] : [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!raw.length || raw.length > 500 || !raw.every((v) => typeof v === 'string' && uuid.test(v))) return null;
  return raw as string[];
}

/** Action `vk_account_delete`: one id or a bulk `ids` list. */
export async function deleteVkAccounts(deps: VkAccountDeps, input: {id?: unknown; ids?: unknown}): Promise<VkActionResult> {
  const ids = readIds(input);
  if (!ids) return fail(400, 'Некорректный список аккаунтов');
  let removed = 0;
  for (const id of ids) {
    const res = await deps.db.prepare('DELETE FROM records WHERE owner=? AND id=? AND kind=?').bind(deps.owner, id, VK_ACCOUNT_KIND).run();
    removed += res.meta.changes;
  }
  return ok({removed});
}

/**
 * Action `vk_account_set_proxy`: '' unbinds (→ no_proxy). A new proxy is checked against the
 * per-proxy cap (AM-11) and the token is validated through it before the account becomes active.
 */
export async function setVkAccountProxy(deps: VkAccountDeps, input: {id?: unknown; proxyId?: unknown}): Promise<VkActionResult> {
  const [id] = readIds({id: input.id}) ?? [];
  if (!id) return fail(400, 'Некорректный аккаунт');
  const proxyId = typeof input.proxyId === 'string' ? input.proxyId : '';
  const accounts = await loadVkAccounts(deps.db, deps.owner);
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return fail(404, 'VK-аккаунт не найден');
  if (!proxyId) {
    await mutateVkAccount(deps.db, deps.owner, id, (d) => ({...d, proxyId: '', status: 'no_proxy', error: ''}));
    return ok({status: 'no_proxy'});
  }
  const plan = await loadProxyPlan(deps);
  const proxy = plan.proxies.find((p) => p.id === proxyId);
  if (!proxy) return fail(400, 'Прокси не найден');
  if (proxy.data.status !== 'active') return fail(409, 'Прокси не активен — проверьте его');
  const used = (plan.load.get(proxyId) ?? 0) - (acc.data.proxyId === proxyId ? 1 : 0);
  if (used >= perProxyCap(deps.settings)) return fail(409, 'На этом прокси уже максимум аккаунтов');
  const token = await unsealToken(deps, acc.secret);
  if (!token) return fail(409, 'Токен аккаунта не читается — удалите и импортируйте заново');
  const v = await validateToken(deps, token, proxyId);
  if (!v.ok) return fail(422, v.reason);
  if (accounts.some((a) => a.id !== id && Number(a.data.vkUserId) === v.vkUserId)) {
    return fail(409, 'Этот VK-аккаунт уже добавлен', {duplicate: true});
  }
  const next = await mutateVkAccount(deps.db, deps.owner, id, (d) => ({...d, proxyId, vkUserId: v.vkUserId, name: v.name, status: 'active', error: ''}));
  await ensureVkSearchSource(deps.db, deps.owner);
  return ok({status: next?.status ?? 'active', name: v.name});
}

async function unsealToken(deps: VkAccountDeps, secret: string | null): Promise<string> {
  if (!secret) return '';
  try {
    return await unseal(secret, deps.owner);
  } catch {
    return '';
  }
}

/** Action `vk_source_add`: resolve the community link, reject a duplicate by numeric id (REQ-4). */
export async function addVkGroupSource(deps: VkAccountDeps, input: {url?: unknown}): Promise<VkActionResult> {
  const ref = parseVkGroupUrl(typeof input.url === 'string' ? input.url : '');
  if (!ref) return fail(400, 'Нужна ссылка на сообщество VK: vk.com/<имя>, club<id> или public<id>');
  const name = ref.kind === 'id' ? ref.groupId : ref.screenName;
  const calls = ref.kind === 'id' ? [vkMethods.groupsGetById([name])] : [vkMethods.utilsResolveScreenName(ref.screenName), vkMethods.groupsGetById([name])];
  const session = await openVkSession({db: deps.db, owner: deps.owner, post: deps.post, caps: VK_DEFAULT_DAILY_CAPS, deadlineAt: Date.now() + 40_000});
  let results: VkResult[];
  try {
    results = await session.run(calls);
  } finally {
    await session.close();
  }
  const byId = results[results.length - 1];
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) {
    if (failed.error.code === VK_CODE_NO_ACCOUNT) return fail(409, 'Нет свободного VK-аккаунта с прокси', {noAccount: true});
    return fail(422, `Сообщество не открылось: ${classifyVkError(failed.error).reason}`);
  }
  const resolvedId = ref.kind === 'id' ? ref.groupId : groupIdFromResolve(results[0].ok ? results[0].response : null);
  const group = byId.ok ? groupsFromGetById(byId.response).find((g) => g.id === resolvedId) : undefined;
  if (!resolvedId || !group) return fail(422, 'Это не сообщество VK или оно не найдено');
  return insertGroupSource(deps, group.id, {title: String(group.name || `club${group.id}`), screenName: String(group.screen_name || '')});
}

async function insertGroupSource(deps: VkAccountDeps, groupId: number, meta: {title: string; screenName: string}): Promise<VkActionResult> {
  const sources = await loadVkSources(deps.db, deps.owner);
  if (sources.some((s) => s.data.type === 'group' && s.data.vkGroupId === groupId)) {
    return fail(409, 'Это сообщество уже добавлено', {duplicate: true});
  }
  const id = await vkRecordId(deps.owner, `vk-source:group:${groupId}`);
  const data: VkSourceData = {
    type: 'group', title: meta.title, vkGroupId: groupId, screenName: meta.screenName, url: canonicalVkGroupUrl(groupId),
    cursor: {}, lastScanAt: '', error: '', leadTombstones: [],
  };
  const res = await deps.db
    .prepare('INSERT OR IGNORE INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
    .bind(id, deps.owner, VK_SOURCE_KIND, JSON.stringify(data), null, new Date().toISOString())
    .run();
  if (res.meta.changes !== 1) return fail(409, 'Это сообщество уже добавлено', {duplicate: true});
  return ok({id, source: data});
}

/**
 * Action `vk_source_delete`. Leads stay; the source's tombstones move to the owner-level holder
 * so a lead the user deleted is not re-created by any later source, even after the last one goes (AM-2).
 */
export async function deleteVkSource(deps: VkAccountDeps, input: {id?: unknown}): Promise<VkActionResult> {
  const [id] = readIds({id: input.id}) ?? [];
  if (!id) return fail(400, 'Некорректный источник');
  const sources = await loadVkSources(deps.db, deps.owner);
  const victim = sources.find((s) => s.id === id);
  if (!victim) return fail(404, 'Источник VK не найден');
  const tombstones = Array.isArray(victim.data.leadTombstones) ? victim.data.leadTombstones.map(String) : [];
  await addVkTombstones(deps.db, deps.owner, tombstones);
  await deps.db.prepare('DELETE FROM records WHERE owner=? AND id=? AND kind=?').bind(deps.owner, id, VK_SOURCE_KIND).run();
  return ok({});
}
