/**
 * Тик сбора аудитории: как понимать ответ воркера /collect-audience (REQ-A1, REQ-A2)
 * и как читать/писать audience_user одной задачи без полного скана владельца (REQ-A6).
 */
import type { D1LikeDatabase } from "@/lib/db";
import { isDeadAccountMailingError } from "@/lib/mailing";
import {
  evaluateJoinGate,
  interpretJoinWorkerResult,
  type JoinProxyState,
  type JoinWorkerResult,
} from "@/lib/processes/join-flow";
import {
  applyQuotaCooldownIfExhausted,
  bumpJoinCounters,
  withFrozenStatus,
} from "@/lib/telegram-accounts";

export type CollectWorkerResult = {
  ok?: boolean;
  status?: string;
  join?: string;
  error?: string;
  waitSec?: number;
  usernameMissing?: boolean;
};

/**
 * Что делать со слотом после неуспешного /collect-audience.
 * dead_session / frozen — метим аккаунт; proxy — метим прокси; flood / transient / slot_blind —
 * аккаунт не трогаем; timeout — повтор тика; source — ошибка задачи (источник закрыт).
 */
export type CollectFailure =
  | { kind: "dead_session" }
  | { kind: "frozen" }
  | { kind: "flood"; waitSec: number }
  | { kind: "timeout" }
  | { kind: "proxy" }
  | { kind: "slot_blind" }
  | { kind: "transient" }
  | { kind: "source" };

export const COLLECT_FLOOD_MIN_WAIT_SEC = 60;

const TIMEOUT_RE = /таймаут|timeout|timed out|прервана|aborted|отменён/i;
const PROXY_RE = /прокси|proxy|socks|ECONN|connection to telegram|не удалось подключ/i;
const SLOT_BLIND_RE = /не видит @|usernameMissing|no user has|nobody is using|username_not_occupied|join.?missing/i;

export function isDeadSessionError(msg: string): boolean {
  return isDeadAccountMailingError(msg) || /tdesktopunauthorized|fromtdesktop/i.test(msg);
}

export function isSlotBlindError(msg: string): boolean {
  return SLOT_BLIND_RE.test(msg);
}

export function classifyCollectFailure(result: CollectWorkerResult): CollectFailure {
  const status = String(result.status || "");
  const join = String(result.join || "");
  const error = String(result.error || "");
  if (status === "flood" || join === "flood") {
    return { kind: "flood", waitSec: Math.max(COLLECT_FLOOD_MIN_WAIT_SEC, Number(result.waitSec) || 0) };
  }
  if (status === "frozen" || join === "frozen") return { kind: "frozen" };
  if (status === "unauthorized" || isDeadSessionError(error)) return { kind: "dead_session" };
  if (status === "source_error" && join !== "banned") return { kind: "source" };
  // Таймаут воркера / отмена — это наш бюджет времени, а не прокси аккаунта (REQ-A2)
  if (TIMEOUT_RE.test(error)) return { kind: "timeout" };
  if (status === "proxy_error" || PROXY_RE.test(error)) return { kind: "proxy" };
  if (result.usernameMissing || join === "missing" || join === "banned" || isSlotBlindError(error)) {
    return { kind: "slot_blind" };
  }
  if (status === "transient" || status === "disconnected") return { kind: "transient" };
  return { kind: "source" };
}

/** Последние (по времени сбора) userId задачи — для фильтра воркера. */
export const AUDIENCE_SEEN_IDS_LIMIT = 5000;

export async function loadAudienceSeenIds(
  db: D1LikeDatabase,
  owner: string,
  taskId: string,
  limit = AUDIENCE_SEEN_IDS_LIMIT,
): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT json_extract(data,'$.userId') AS userId FROM records " +
        "WHERE owner=? AND kind='audience_user' AND json_extract(data,'$.taskId')=? " +
        "ORDER BY created DESC, rowid DESC LIMIT ?",
    )
    .bind(owner, taskId, limit)
    .all();
  return rows.results.map((r) => String(r.userId ?? "")).filter(Boolean);
}

/** Все пользователи задачи в порядке сбора (экспорт). */
export async function listAudienceUsers(
  db: D1LikeDatabase,
  owner: string,
  taskId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .prepare(
      "SELECT data FROM records WHERE owner=? AND kind='audience_user' AND json_extract(data,'$.taskId')=? " +
        "ORDER BY created, rowid",
    )
    .bind(owner, taskId)
    .all();
  const users: Record<string, unknown>[] = [];
  for (const r of rows.results) {
    try {
      users.push(JSON.parse(String(r.data)) as Record<string, unknown>);
    } catch {
      // битая строка не должна ронять экспорт всей базы
    }
  }
  return users;
}

export type AudienceUserData = { userId: string } & Record<string, unknown>;

/** D1: не больше 100 bind-параметров на запрос. */
const INSERT_ROWS_PER_STATEMENT = 16;
const LOOKUP_IDS_PER_STATEMENT = 90;

/** Один и тот же (владелец, задача, пользователь) → один и тот же id записи: повторная вставка игнорируется. */
export async function audienceUserRecordId(owner: string, taskId: string, userId: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${owner}\u0000${taskId}\u0000${userId}`)),
  ).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function existingUserIds(
  db: D1LikeDatabase,
  owner: string,
  taskId: string,
  userIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < userIds.length; i += LOOKUP_IDS_PER_STATEMENT) {
    const chunk = userIds.slice(i, i + LOOKUP_IDS_PER_STATEMENT);
    const rows = await db
      .prepare(
        "SELECT json_extract(data,'$.userId') AS userId FROM records " +
          "WHERE owner=? AND kind='audience_user' AND json_extract(data,'$.taskId')=? " +
          `AND json_extract(data,'$.userId') IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(owner, taskId, ...chunk)
      .all();
    for (const r of rows.results) found.add(String(r.userId ?? ""));
  }
  return found;
}

/**
 * Пакетная вставка без дублей (задача, пользователь): старые строки с random id ловит
 * предварительный SELECT, новые — детерминированный id + INSERT OR IGNORE. Возвращает число вставленных.
 */
export async function insertAudienceUsers(
  db: D1LikeDatabase,
  owner: string,
  taskId: string,
  users: AudienceUserData[],
  now = new Date(),
): Promise<number> {
  const unique = new Map<string, AudienceUserData>();
  for (const u of users) if (u.userId && !unique.has(u.userId)) unique.set(u.userId, u);
  const known = await existingUserIds(db, owner, taskId, [...unique.keys()]);
  const fresh = [...unique.values()].filter((u) => !known.has(u.userId));
  const created = now.toISOString();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += INSERT_ROWS_PER_STATEMENT) {
    const chunk = fresh.slice(i, i + INSERT_ROWS_PER_STATEMENT);
    const values: unknown[] = [];
    for (const u of chunk) {
      values.push(
        await audienceUserRecordId(owner, taskId, u.userId),
        owner,
        "audience_user",
        JSON.stringify({ ...u, taskId }),
        null,
        created,
      );
    }
    const res = await db
      .prepare(
        "INSERT OR IGNORE INTO records(id,owner,kind,data,secret,created) VALUES " +
          chunk.map(() => "(?,?,?,?,?,?)").join(","),
      )
      .bind(...values)
      .run();
    inserted += Number(res.meta?.changes) || 0;
  }
  return inserted;
}

export type AudienceSourcePeer = {
  sourceChannelId: string;
  sourceAccessHash: string;
  sourceAccountId: string;
};

/** REQ-A7: peer, выданный join этой сессии, — чтобы следующий тик не резолвил @username заново. */
export function sourcePeerFromJoin(
  joinRes: { channelId?: unknown; accessHash?: unknown },
  accountId: string,
): AudienceSourcePeer | null {
  const channelId = String(joinRes.channelId ?? "").slice(0, 40);
  const accessHash = String(joinRes.accessHash ?? "").slice(0, 40);
  if (!channelId || !accessHash) return null;
  return { sourceChannelId: channelId, sourceAccessHash: accessHash, sourceAccountId: accountId };
}

/** Пауза тика, когда join упёрся в гейт: с запасными слотами — короткая (ротация), иначе ждём сам гейт. */
export const JOIN_GATE_ROTATE_WAIT_SEC = 60;
const JOIN_GATE_FALLBACK_WAIT_SEC = 3600;

export type AudienceJoinGate = { ok: true } | { ok: false; waitSec: number; message: string };

/**
 * REQ-A4: тот же гейт квоты/темпа/прокси, что у вступления из «Группы».
 * proxy: запись прокси аккаунта (undefined — прокси не назначен, null — назначен, но записи нет).
 */
export function audienceJoinGate(
  url: string,
  accountId: string,
  account: Record<string, unknown> | undefined,
  spareSlots: boolean,
  proxy?: JoinProxyState | null,
): AudienceJoinGate {
  const gate = evaluateJoinGate({ groupUrl: url, accountId, account: account ?? null, proxy });
  if (gate.ok) return gate;
  const waitSec = spareSlots ? JOIN_GATE_ROTATE_WAIT_SEC : (gate.waitSec ?? JOIN_GATE_FALLBACK_WAIT_SEC);
  return { ok: false, waitSec, message: gate.message };
}

export type AudienceJoinStep =
  | { kind: "member"; account?: Record<string, unknown>; peer: AudienceSourcePeer | null }
  | { kind: "pending"; account: Record<string, unknown>; peer: AudienceSourcePeer | null }
  | { kind: "flood"; waitSec: number; account: Record<string, unknown> }
  | { kind: "frozen"; account: Record<string, unknown> }
  | { kind: "fail"; error: string };

export const JOIN_PENDING_ERROR = "Заявка на вступление отправлена — ждём одобрения заявки";

/**
 * REQ-A3/A4/A7: ответ /join-group для задачи сбора. Счётчики вступлений растут на joined и
 * на заявке (это тоже вступление для Telegram); FloodWait ставит темп аккаунту, без отлёжки.
 */
export function interpretAudienceJoin(
  joinRes: JoinWorkerResult & { channelId?: unknown; accessHash?: unknown; waitSec?: unknown },
  account: Record<string, unknown>,
  accountId: string,
  now = new Date(),
): AudienceJoinStep {
  const outcome = interpretJoinWorkerResult({ ...joinRes, floodWait: Number(joinRes.waitSec) || joinRes.floodWait });
  const peer = sourcePeerFromJoin(joinRes, accountId);
  const bumped = () => applyQuotaCooldownIfExhausted({ ...account, ...bumpJoinCounters(account) }, "invite");
  switch (outcome.kind) {
    case "joined":
      return { kind: "member", account: bumped(), peer };
    case "already":
      return { kind: "member", peer };
    case "pending":
      return { kind: "pending", account: bumped(), peer };
    case "flood":
      return {
        kind: "flood",
        waitSec: outcome.waitSec,
        account: { ...account, lastJoinAt: now.toISOString(), error: String(joinRes.error || "").slice(0, 500) },
      };
    case "frozen":
      return { kind: "frozen", account: withFrozenStatus(account, outcome.error) };
    default:
      return { kind: "fail", error: outcome.error };
  }
}
