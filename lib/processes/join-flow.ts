/** Решения по вступлению в группы (чистая логика для тестов и route). */

import { isCatalogPlaceholderUrl } from "@/lib/group-catalog";
import {
  hasInviteQuota,
  isAccountUsable,
  isDayLimitCooldown,
  joinWaitSec,
} from "@/lib/telegram-accounts";

export function sanitizeJoinStateError(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, 500);
}

export type JoinBlockReason =
  | "missing_account"
  | "placeholder_url"
  | "cooldown"
  | "spamblock"
  | "frozen"
  | "quota"
  | "pace"
  | "resolve_blind"
  | "proxy"
  | "unusable";

export type JoinGateResult =
  | { ok: true }
  | { ok: false; reason: JoinBlockReason; waitSec?: number; message: string };

export type JoinAccountState = {
  status?: string | null;
  cooldownUntil?: string | null;
  limits?: { invite?: unknown };
  joinsToday?: number;
  joinsDay?: string;
  lastJoinAt?: string;
  joinFloodUntil?: string;
  resolveBlindUntil?: string | null;
  proxyId?: string | null;
};

export type JoinProxyState = { status?: string | null };

/**
 * Единственное правило «аккаунт может вступать прямо сейчас»: авторизован и активен,
 * не спамблок/заморозка/отлёжка, резолвит @username, прокси жив, есть дневная квота
 * и пауза/FloodWait прошли. proxy: запись прокси аккаунта; null — proxyId указан,
 * а прокси нет (join без прокси засветил бы IP сервера).
 */
export function evaluateAccountJoinReadiness(
  acc: JoinAccountState | null | undefined,
  opts: { proxy?: JoinProxyState | null; now?: number } = {},
): JoinGateResult {
  const now = opts.now ?? Date.now();
  if (!acc) {
    return { ok: false, reason: "unusable", message: "Аккаунт не найден" };
  }
  const st = String(acc.status || "");
  if (st === "spamblock") {
    return { ok: false, reason: "spamblock", message: "Аккаунт в спамблоке" };
  }
  if (st === "frozen") {
    return { ok: false, reason: "frozen", message: "Аккаунт заморожен" };
  }
  if (isDayLimitCooldown(acc)) {
    const until = Date.parse(String(acc.cooldownUntil || ""));
    const waitSec = Math.max(60, Math.ceil((until - now) / 1000) || 300);
    return { ok: false, reason: "cooldown", waitSec, message: "Аккаунт на отлёжке" };
  }
  if (!isAccountUsable(acc)) {
    return { ok: false, reason: "unusable", message: "Аккаунт недоступен" };
  }
  if (isAccountResolveBlind(acc, now)) {
    const until = Date.parse(String(acc.resolveBlindUntil));
    return {
      ok: false,
      reason: "resolve_blind",
      waitSec: Math.max(300, Math.ceil((until - now) / 1000)),
      message: "Аккаунт не резолвит @username (ограничен Telegram)",
    };
  }
  if (String(acc.proxyId || "") && (opts.proxy == null || opts.proxy.status === "inactive")) {
    return { ok: false, reason: "proxy", message: "Прокси аккаунта не работает" };
  }
  if (!hasInviteQuota(acc)) {
    return { ok: false, reason: "quota", message: "Дневной лимит вступлений исчерпан" };
  }
  const wait = joinWaitSec(acc, now);
  if (wait > 0) {
    return {
      ok: false,
      reason: "pace",
      waitSec: wait,
      message: `Пауза между вступлениями: ${wait} с`,
    };
  }
  return { ok: true };
}

/** Аккаунт можно назначить группе под вступление: готов сейчас или ждёт только паузу темпа. */
export function isJoinFarmCandidate(
  acc: JoinAccountState | null | undefined,
  opts: { proxy?: JoinProxyState | null; now?: number } = {},
): boolean {
  const gate = evaluateAccountJoinReadiness(acc, opts);
  return gate.ok || gate.reason === "pace";
}

/** Можно ли сейчас слать join_group для этой пары group+account. */
export function evaluateJoinGate(opts: {
  groupUrl?: string;
  accountId?: string;
  account?: JoinAccountState | null;
  proxy?: JoinProxyState | null;
  now?: number;
}): JoinGateResult {
  if (!opts.accountId) {
    return { ok: false, reason: "missing_account", message: "Назначьте аккаунт группе" };
  }
  if (isCatalogPlaceholderUrl(opts.groupUrl || "")) {
    return {
      ok: false,
      reason: "placeholder_url",
      message: "Нужна реальная ссылка t.me/… или инвайт (это шаблон каталога)",
    };
  }
  return evaluateAccountJoinReadiness(opts.account, {
    proxy: opts.proxy,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
}

export type JoinWorkerResult = {
  ok?: boolean;
  join?: string;
  status?: string;
  error?: string;
  title?: string;
  floodWait?: number;
};

export type JoinOutcome =
  | { kind: "joined"; membership: "joined" }
  | { kind: "pending"; membership: "pending" }
  | { kind: "already"; membership: "joined" }
  | { kind: "flood"; waitSec: number; pace: true }
  | { kind: "frozen"; error: string }
  | { kind: "fail"; error: string };

/** Интерпретация ответа worker /join-group. */
export function interpretJoinWorkerResult(result: JoinWorkerResult): JoinOutcome {
  const err = String(result.error || "");
  const frozen =
    result.status === "frozen" ||
    result.join === "frozen" ||
    /FROZEN|заморожен/i.test(err);
  if (frozen) {
    return { kind: "frozen", error: err.slice(0, 500) || "Аккаунт заморожен Telegram" };
  }
  const flood =
    result.join === "flood" ||
    /FloodWait/i.test(err) ||
    Number(result.floodWait) > 0;
  if (flood) {
    const m = /FloodWait\s+(\d+)/i.exec(err);
    const waitSec = Math.max(
      60,
      Number(result.floodWait) || (m ? Number(m[1]) : 0) || 900,
    );
    return { kind: "flood", waitSec, pace: true };
  }
  if (result.join === "already") {
    return { kind: "already", membership: "joined" };
  }
  if (result.join === "requested") {
    return { kind: "pending", membership: "pending" };
  }
  const reallyJoined =
    !!result.ok &&
    result.join !== "requested" &&
    result.join !== "flood" &&
    result.join !== "missing" &&
    result.join !== "frozen";
  if (reallyJoined || result.join === "ok") {
    return { kind: "joined", membership: "joined" };
  }
  return { kind: "fail", error: err.slice(0, 500) || "Не удалось вступить" };
}

/** После стольких неудачных вступлений группа помечается отказом (joinGaveUp). */
export const JOIN_MAX_ATTEMPTS = 5;
const JOIN_RETRY_BASE_MS = 30 * 60_000;
const JOIN_RETRY_MAX_MS = 24 * 60 * 60_000;
/** Сбой воркера/сети — не вина группы: попытку не считаем, но и не долбим. */
export const JOIN_WORKER_ERROR_RETRY_MS = 15 * 60_000;

export function joinRetryDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(JOIN_RETRY_MAX_MS, JOIN_RETRY_BASE_MS * 2 ** (n - 1));
}

type JoinRetryFields = {
  joinAttempts?: number;
  joinNextAt?: string;
  joinGaveUp?: boolean;
};

/** Поля группы после неудачного вступления (backoff + отказ после лимита). */
export function joinFailurePatch(
  group: JoinRetryFields,
  now = Date.now(),
): Required<JoinRetryFields> {
  const attempts = Math.max(0, Number(group.joinAttempts) || 0) + 1;
  return {
    joinAttempts: attempts,
    joinNextAt: new Date(now + joinRetryDelayMs(attempts)).toISOString(),
    joinGaveUp: attempts >= JOIN_MAX_ATTEMPTS,
  };
}

/** Слот не резолвит даже @telegram — даём ему отлежаться, вступать им нельзя. */
export const ACCOUNT_BLIND_COOLDOWN_MS = 6 * 60 * 60_000;

/** Воркер подтвердил, что слеп аккаунт, а не группа (контрольный @telegram тоже не виден). */
export function isAccountBlindResult(result: { accountBlind?: unknown } | null | undefined): boolean {
  return result?.accountBlind === true;
}

export function isAccountResolveBlind(
  account: { resolveBlindUntil?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  const until = Date.parse(String(account?.resolveBlindUntil || ""));
  return Number.isFinite(until) && until > now;
}

export function accountBlindPatch(now = Date.now()): { resolveBlindUntil: string } {
  return { resolveBlindUntil: new Date(now + ACCOUNT_BLIND_COOLDOWN_MS).toISOString() };
}

export const JOIN_SUCCESS_PATCH: Required<JoinRetryFields> = {
  joinAttempts: 0,
  joinNextAt: "",
  joinGaveUp: false,
};
