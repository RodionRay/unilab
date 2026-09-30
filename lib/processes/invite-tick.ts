/** Решения тика инвайтинга (чистая логика; route.ts — только ввод/вывод). */

import {
  applyQuotaCooldownIfExhausted,
  hasMemberInviteQuota,
  isAccountUsable,
  moscowDayKey,
  withFrozenStatus,
  withSpamblockStatus,
} from "@/lib/telegram-accounts";

export type InviteWorkerUserResult = {
  ok?: boolean;
  userId?: string;
  username?: string;
  error?: string;
};

export type InviteWorkerResult = {
  ok?: boolean;
  status?: string;
  error?: string;
  floodWait?: number;
  targetError?: string;
  accountBlind?: boolean;
  results?: InviteWorkerUserResult[];
};

/**
 * invited — приглашён (квота); already — уже в группе (без квоты);
 * skipped — постоянный отказ (privacy и т.п.), без повторов;
 * retry — не нашли пользователя этим слотом, другой слот может пройти; failed — прочее.
 */
export type InviteUserVerdict = "invited" | "already" | "skipped" | "retry" | "failed";

export type InviteUserEntry = {
  userId: string;
  username: string;
  verdict: InviteUserVerdict;
  reason: string;
};

type InviteBatchSummary = {
  users: InviteUserEntry[];
  okN: number;
  alreadyN: number;
  skippedN: number;
  failN: number;
  accountPatch?: Record<string, unknown>;
  wentCooldown: boolean;
};

export type InviteTickOutcome = InviteBatchSummary &
  (
    | { kind: "batch" }
    | { kind: "spamblock" }
    | { kind: "frozen" }
    | { kind: "flood"; waitSec: number }
    | { kind: "target_error"; code: string; message: string }
    | { kind: "account_blind"; message: string }
  );

export const INVITE_SOFT_FAIL_LIMIT = 3;
const ALREADY_RE = /^already$|USER_ALREADY_PARTICIPANT/i;
const PERMANENT_RE = /privacy|USER_NOT_MUTUAL_CONTACT|^kicked$|USER_KICKED|channels_too_much|USER_CHANNELS_TOO_MUCH|^bot$|USER_BOT/i;
const RETRY_RE = /no_entity|не удалось|access_hash|PEER_ID_INVALID|could not find the input entity/i;

const TARGET_ERROR_TEXT: Readonly<Record<string, string>> = {
  need_admin: "Нужны права администратора: целевая группа не даёт аккаунту приглашать участников",
  chat_full: "Целевая группа заполнена — достигнут лимит участников Telegram",
  broadcast: "Цель — канал, не группа. Инвайт участников работает только в супергруппу/чат.",
  target_private: "Целевая группа недоступна аккаунту (приватная или аккаунт в ней забанен)",
  target_forbidden: "Аккаунту запрещено приглашать в целевую группу",
  target_invalid: "Целевая группа не найдена или недоступна",
  target_missing: "Целевая группа не найдена",
  need_join: "Аккаунт не состоит в целевой группе",
};

export function classifyInviteUser(r: InviteWorkerUserResult): { verdict: InviteUserVerdict; reason: string } {
  const reason = String(r.error || "").slice(0, 120);
  if (ALREADY_RE.test(reason)) return { verdict: "already", reason: "already" };
  if (r.ok) return { verdict: "invited", reason: "" };
  if (PERMANENT_RE.test(reason)) return { verdict: "skipped", reason: /privacy/i.test(reason) ? "privacy" : reason };
  if (RETRY_RE.test(reason)) return { verdict: "retry", reason };
  return { verdict: "failed", reason: reason || "fail" };
}

/** Что записать в audience_user по вердикту. `invited:true` = обработан задачей, повторно не берём. */
export function inviteUserPatch(
  entry: { verdict: InviteUserVerdict; reason: string },
  user: Record<string, unknown>,
): Record<string, unknown> {
  if (entry.verdict === "invited") return { invited: true, skipReason: "" };
  if (entry.verdict !== "retry") return { invited: true, skipReason: entry.reason };
  const softFails = (Number(user.inviteSoftFails) || 0) + 1;
  return softFails >= INVITE_SOFT_FAIL_LIMIT
    ? { invited: true, skipReason: "soft_fail_limit", inviteSoftFails: softFails }
    : { invited: false, skipReason: entry.reason, inviteSoftFails: softFails };
}

/** Размер батча: batchSize (1..20), но не больше остатка дневного лимита задачи. */
export function inviteBatchLimit(
  task: { batchSize?: unknown; dailyLimitEnabled?: unknown; dailyLimit?: unknown },
  invitedToday: number,
): number {
  const size = Math.max(1, Math.min(20, Number(task.batchSize) || 1));
  if (!task.dailyLimitEnabled) return size;
  const left = (Number(task.dailyLimit) || 50) - invitedToday;
  return Math.max(0, Math.min(size, left));
}

function summarize(results: InviteWorkerUserResult[]): InviteBatchSummary {
  const users: InviteUserEntry[] = [];
  const counts = { okN: 0, alreadyN: 0, skippedN: 0, failN: 0 };
  for (const r of results) {
    // need_admin касается цели, а не пользователя — его не трогаем
    if (!r.ok && r.error === "need_admin") continue;
    const { verdict, reason } = classifyInviteUser(r);
    users.push({ userId: String(r.userId || ""), username: String(r.username || ""), verdict, reason });
    if (verdict === "invited") counts.okN++;
    else if (verdict === "already") counts.alreadyN++;
    else {
      counts.failN++;
      if (verdict === "skipped") counts.skippedN++;
    }
  }
  return { users, ...counts, wentCooldown: false };
}

function bumpMemberInvites(account: Record<string, unknown>, okN: number, now: Date): Record<string, unknown> {
  const day = moscowDayKey(now);
  const prev = account.memberInviteDay === day ? Number(account.memberInvitesToday) || 0 : 0;
  return applyQuotaCooldownIfExhausted({ ...account, memberInviteDay: day, memberInvitesToday: prev + okN }, "memberInvite");
}

function targetError(result: InviteWorkerResult): { code: string; message: string } | null {
  const legacyNeedAdmin = (result.results || []).some((r) => !r.ok && r.error === "need_admin");
  if (result.status !== "target_error" && !legacyNeedAdmin && result.ok !== false) return null;
  const code = String(result.targetError || (legacyNeedAdmin ? "need_admin" : "target"));
  const message =
    String(result.error || "").trim() ||
    TARGET_ERROR_TEXT[code] ||
    "Воркер не смог пригласить в целевую группу";
  return { code, message: message.slice(0, 500) };
}

/**
 * Разбор /invite-users. Квота аккаунта бампится за реальные инвайты при любом исходе
 * (в т.ч. FloodWait / ошибка цели посреди батча); «уже в группе» квоту не тратит.
 */
export function interpretInviteWorkerResult(
  result: InviteWorkerResult,
  account: Record<string, unknown>,
  now = new Date(),
): InviteTickOutcome {
  const summary = summarize(result.results || []);
  const bumped = summary.okN > 0 ? bumpMemberInvites(account, summary.okN, now) : undefined;
  const err = String(result.error || "");

  if (result.status === "spamblock" || err.includes("PEER_FLOOD")) {
    return { ...summary, kind: "spamblock", accountPatch: withSpamblockStatus(bumped || account, "PEER_FLOOD"), wentCooldown: true };
  }
  if (result.status === "frozen") {
    return { ...summary, kind: "frozen", accountPatch: withFrozenStatus(bumped || account, err || "Аккаунт заморожен"), wentCooldown: true };
  }
  const withQuota = { ...summary, accountPatch: bumped, wentCooldown: bumped?.status === "cooldown" };
  if (result.status === "floodwait" || Number(result.floodWait) > 0) {
    return { ...withQuota, kind: "flood", waitSec: Math.max(60, Number(result.floodWait) || 900) };
  }
  if (result.accountBlind) {
    return { ...withQuota, kind: "account_blind", message: err.slice(0, 500) };
  }
  const target = targetError(result);
  if (target) return { ...withQuota, kind: "target_error", ...target };
  return { ...withQuota, kind: "batch" };
}

/** Жив ли слот для следующего тика инвайта. */
type InviteSlot = NonNullable<Parameters<typeof isAccountUsable>[0]> &
  NonNullable<Parameters<typeof hasMemberInviteQuota>[0]>;

export function inviteAccountStillLive(account: InviteSlot | null | undefined, wentCooldown: boolean): boolean {
  if (wentCooldown) return false;
  if (!isAccountUsable(account)) return false;
  return hasMemberInviteQuota(account);
}
