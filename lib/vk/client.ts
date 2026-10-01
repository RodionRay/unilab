/**
 * VK API client over the worker route /vk-call (telegram-worker/src/vk_api.py).
 * The worker owns transport (proxy, pacing, deadline); this module owns call shapes,
 * response narrowing and the error policy (spec vk-lead-source AM-8).
 * `post` is injected so the app wires its own worker fetch (T3) and tests pass a fake.
 */
import {moscowNextMidnightIso} from '@/lib/telegram-accounts';

export const VK_API_VERSION = '5.199';
export const VK_CALL_PATH = '/vk-call';
export const VK_MAX_BATCH = 25;
/** Worker job timeout (worker-app.mjs VK_CALL_TIMEOUT_MS, 60 s) plus queue/network margin. */
export const VK_CALL_TIMEOUT_MS = 70_000;
export const VK_NEWSFEED_MAX_COUNT = 200;
export const VK_PAGE_MAX_COUNT = 100;

/** Transport codes produced by vk_api.py / this client; VK's own codes are positive. */
export const VK_CODE_DEADLINE = -1;
export const VK_CODE_NETWORK = -2;
export const VK_CODE_HTTP = -3;
export const VK_CODE_BAD_RESPONSE = -4;
export const VK_CODE_PROXY = -5;

export type VkParam = string | number | boolean | readonly (string | number)[];
export type VkCall = {readonly method: string; readonly params: Readonly<Record<string, VkParam>>};
export type VkError = {code: number; msg: string};
export type VkResult<T = unknown> = {ok: true; response: T} | {ok: false; error: VkError};
export type VkProxy = {
  host: string;
  port: number | string;
  protocol: 'socks5' | 'http';
  username?: string;
  password?: string;
};
export type WorkerPost = (path: string, body: unknown, ms: number) => Promise<unknown>;

export type VkProfile = {id: number; first_name?: string; last_name?: string; screen_name?: string};
export type VkGroup = {id: number; name?: string; screen_name?: string; is_closed?: number; type?: string};
export type VkPost = {
  id: number;
  owner_id: number;
  from_id?: number;
  date: number;
  text?: string;
  signer_id?: number;
  post_type?: string;
  comments?: {count?: number};
};
export type VkWallComment = {
  id: number;
  from_id: number;
  date: number;
  text?: string;
  post_id?: number;
  owner_id?: number;
  parents_stack?: number[];
  thread?: {count?: number; items?: VkWallComment[]};
};
export type VkBoardTopic = {id: number; title?: string; created?: number; updated?: number; comments?: number; is_closed?: number};
export type VkBoardComment = {id: number; from_id: number; date: number; text?: string};
export type VkExtended<T> = {count?: number; items: T[]; profiles?: VkProfile[]; groups?: VkGroup[]};
export type VkNewsfeedSearch = VkExtended<VkPost> & {next_from?: string; total_count?: number};
export type VkResolvedName = {type: string; object_id: number};

export type NewsfeedSearchParams = {
  q: string;
  startTime?: number;
  endTime?: number;
  startFrom?: string;
  count?: number;
};

/** Call builders: one place that knows VK method names and parameter spelling. */
export const vkMethods = {
  usersGet: (): VkCall => ({method: 'users.get', params: {}}),
  newsfeedSearch: (p: NewsfeedSearchParams): VkCall => ({
    method: 'newsfeed.search',
    params: {
      q: p.q,
      extended: 1,
      count: clampCount(p.count, VK_NEWSFEED_MAX_COUNT),
      ...(p.startTime !== undefined ? {start_time: p.startTime} : {}),
      ...(p.endTime !== undefined ? {end_time: p.endTime} : {}),
      ...(p.startFrom ? {start_from: p.startFrom} : {}),
    },
  }),
  wallGet: (p: {groupId: number; offset?: number; count?: number}): VkCall => ({
    method: 'wall.get',
    params: {owner_id: -p.groupId, offset: p.offset ?? 0, count: clampCount(p.count, VK_PAGE_MAX_COUNT), extended: 1},
  }),
  wallGetComments: (p: {ownerId: number; postId: number; offset?: number; count?: number}): VkCall => ({
    method: 'wall.getComments',
    params: {
      owner_id: p.ownerId,
      post_id: p.postId,
      offset: p.offset ?? 0,
      count: clampCount(p.count, VK_PAGE_MAX_COUNT),
      sort: 'desc',
      thread_items_count: 10,
      extended: 1,
    },
  }),
  boardGetTopics: (p: {groupId: number; offset?: number; count?: number}): VkCall => ({
    method: 'board.getTopics',
    // order 1 = by last update, newest first: new comments surface first.
    params: {group_id: p.groupId, order: 1, offset: p.offset ?? 0, count: clampCount(p.count, VK_PAGE_MAX_COUNT)},
  }),
  boardGetComments: (p: {groupId: number; topicId: number; offset?: number; count?: number}): VkCall => ({
    method: 'board.getComments',
    params: {
      group_id: p.groupId,
      topic_id: p.topicId,
      offset: p.offset ?? 0,
      count: clampCount(p.count, VK_PAGE_MAX_COUNT),
      sort: 'desc',
      extended: 1,
    },
  }),
  groupsGetById: (groupIds: readonly (number | string)[]): VkCall => ({
    method: 'groups.getById',
    params: {group_ids: groupIds},
  }),
  utilsResolveScreenName: (screenName: string): VkCall => ({
    method: 'utils.resolveScreenName',
    params: {screen_name: screenName},
  }),
} as const;

function clampCount(count: number | undefined, max: number): number {
  if (count === undefined || !Number.isFinite(count)) return max;
  return Math.min(max, Math.max(1, Math.floor(count)));
}

/** groups.getById returns `{groups, profiles}` since 5.194 and a bare array before. */
export function groupsFromGetById(response: unknown): VkGroup[] {
  const list = Array.isArray(response) ? response : isRecord(response) ? response.groups : undefined;
  return Array.isArray(list) ? list.filter(isGroup) : [];
}

/** Community id from utils.resolveScreenName, or null for users/apps/unknown names (VK answers `[]`). */
export function groupIdFromResolve(response: unknown): number | null {
  if (!isRecord(response)) return null;
  const type = String(response.type ?? '');
  const id = Number(response.object_id);
  if (!['group', 'page', 'event'].includes(type) || !Number.isInteger(id) || id <= 0) return null;
  return id;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isGroup(v: unknown): v is VkGroup {
  return isRecord(v) && Number.isInteger(v.id);
}

function failAll(count: number, error: VkError): VkResult[] {
  return Array.from({length: count}, () => ({ok: false, error}));
}

function narrowResult(raw: unknown): VkResult {
  if (isRecord(raw) && raw.ok === true && 'response' in raw) return {ok: true, response: raw.response};
  const err = isRecord(raw) && isRecord(raw.error) ? raw.error : null;
  const code = Number(err?.code);
  return {
    ok: false,
    error: {code: Number.isInteger(code) ? code : VK_CODE_BAD_RESPONSE, msg: String(err?.msg ?? 'bad result')},
  };
}

/**
 * Run up to 25 calls through the worker with one account's token and proxy.
 * Always resolves with exactly one result per call; a worker failure fails every call
 * with a transport code so the caller applies one error policy to all outcomes.
 */
export async function runVkBatch(
  post: WorkerPost,
  input: {token: string; proxy: VkProxy | null; calls: readonly VkCall[]},
): Promise<VkResult[]> {
  const n = input.calls.length;
  if (n < 1 || n > VK_MAX_BATCH) throw new RangeError(`VK batch must hold 1..${VK_MAX_BATCH} calls`);
  let reply: unknown;
  try {
    reply = await post(VK_CALL_PATH, {token: input.token, proxy: input.proxy, calls: input.calls}, VK_CALL_TIMEOUT_MS);
  } catch {
    return failAll(n, {code: VK_CODE_NETWORK, msg: 'worker unreachable'});
  }
  if (!isRecord(reply)) return failAll(n, {code: VK_CODE_BAD_RESPONSE, msg: 'worker: bad reply'});
  if (reply.status === 'proxy_error') {
    return failAll(n, {code: VK_CODE_PROXY, msg: String(reply.error ?? 'proxy rejected').slice(0, 300)});
  }
  const results = reply.results;
  if (reply.ok !== true || !Array.isArray(results) || results.length !== n) {
    return failAll(n, {code: VK_CODE_NETWORK, msg: String(reply.error ?? 'worker failed').slice(0, 300)});
  }
  return results.map(narrowResult);
}

export type VkErrorKind = 'retry' | 'cooldown' | 'method_blocked' | 'account_error' | 'skip_item';
export type VkErrorClass = {kind: VkErrorKind; code: number; reason: string; until?: string};

const MINUTE_MS = 60_000;
/** Error 9 (flood control): the action is rate-limited for a while; VK gives no duration. */
export const VK_FLOOD_COOLDOWN_MS = 30 * MINUTE_MS;
/** Error 14 (captcha): no captcha solving in M1, rest the account (AM-8). */
export const VK_CAPTCHA_COOLDOWN_MS = 60 * MINUTE_MS;
/** Proxy refused by the worker guard or unusable: rest the account until someone fixes the proxy. */
export const VK_PROXY_COOLDOWN_MS = 15 * MINUTE_MS;

const ACCOUNT_ERRORS: Record<number, string> = {
  5: 'Токен недействителен или истёк',
  17: 'Требуется проверка аккаунта (validation required)',
  18: 'Страница удалена или заблокирована',
};
const SKIP_ERRORS: Record<number, string> = {
  15: 'Нет доступа',
  30: 'Профиль закрыт',
  203: 'Нет доступа к сообществу',
  212: 'Нет доступа к комментариям',
};

/**
 * AM-8 error policy. `retry`: transient, same token is fine later (6, network, deadline,
 * VK internal errors). `cooldown`: rest the account until `until` (9, 14, proxy).
 * `method_blocked`: daily method limit hit (29) — only this method, until Moscow midnight.
 * `account_error`: token/account dead (5, 17, 18). `skip_item`: this item/source is closed
 * (15, 30, 203, 212) or the request itself is wrong — no failover, another token won't help.
 */
export function classifyVkError(error: VkError, now: number = Date.now()): VkErrorClass {
  const {code} = error;
  const at = (ms: number) => new Date(now + ms).toISOString();
  if (code in ACCOUNT_ERRORS) return {kind: 'account_error', code, reason: ACCOUNT_ERRORS[code]};
  if (code in SKIP_ERRORS) return {kind: 'skip_item', code, reason: SKIP_ERRORS[code]};
  if (code === 9) return {kind: 'cooldown', code, reason: 'Flood control', until: at(VK_FLOOD_COOLDOWN_MS)};
  if (code === 14) return {kind: 'cooldown', code, reason: 'Captcha', until: at(VK_CAPTCHA_COOLDOWN_MS)};
  if (code === VK_CODE_PROXY) return {kind: 'cooldown', code, reason: 'Прокси недоступен', until: at(VK_PROXY_COOLDOWN_MS)};
  if (code === 29) return {kind: 'method_blocked', code, reason: 'Дневной лимит метода', until: moscowNextMidnightIso(now)};
  if (code === 6 || code === 1 || code === 10 || code < 0) {
    return {kind: 'retry', code, reason: code === VK_CODE_DEADLINE ? 'Не успели за отведённое время' : 'Временная ошибка VK'};
  }
  return {kind: 'skip_item', code, reason: `Ошибка VK ${code}`};
}

/** REQ-1b: every class except `skip_item` moves the run to the next account. */
export function shouldFailOver(cls: VkErrorClass): boolean {
  return cls.kind !== 'skip_item';
}
