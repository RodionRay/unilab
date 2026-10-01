/** Решения тика рассылки по ответу воркера. */

import {
  isDeadAccountMailingError,
  isPeerFloodMailingError,
  isPermanentMailingRecipientError,
  isRateLimitMailingError,
  isTransientPeerResolveError,
  parseMailingFloodWaitSec,
  recipientKey,
  type MailingDeliveryMode,
} from "@/lib/mailing";
import {
  applyQuotaCooldownIfExhausted,
  bumpChatCounters,
  bumpMessageCounters,
  withFrozenStatus,
  withSpamblockStatus,
} from "@/lib/telegram-accounts";

export type MailingSendResult = {
  ok?: boolean;
  status?: string;
  error?: string;
  flood?: boolean;
  waitSec?: number;
  floodWait?: number;
};

/** Отказ по получателю: сменить слот / списать навсегда / аккаунт мёртв / повторить позже. */
export type MailingFailKind = "peer_miss" | "permanent" | "dead_account" | "retry";

export type MailingSendOutcome =
  | { kind: "ok"; bumped: Record<string, unknown>; wentDayCooldown: boolean }
  | { kind: "rate_limit"; waitSec: number; accountPatch: Record<string, unknown> }
  | { kind: "spamblock"; writeBan: boolean; accountPatch: Record<string, unknown> }
  | { kind: "frozen"; accountPatch: Record<string, unknown> }
  | { kind: "fail"; failKind: MailingFailKind; error: string };

const WRITE_BAN_RE = /banned from sending|chat_write_forbidden|user_banned_in_channel/i;

/** Успешная отправка: +1 к счётчику вида и отлёжка, только если кончилась именно эта квота. */
export function creditMailingSend(
  account: Record<string, unknown>,
  deliveryMode: MailingDeliveryMode,
): Record<string, unknown> {
  const counters =
    deliveryMode === "chat"
      ? bumpChatCounters(account, 1)
      : bumpMessageCounters(account, 1);
  return applyQuotaCooldownIfExhausted(
    { ...account, ...counters },
    deliveryMode === "chat" ? "chat" : "message",
  );
}

function classifyFailure(errRaw: string): MailingFailKind {
  if (isTransientPeerResolveError(errRaw)) return "peer_miss";
  // До permanent: USER_DEACTIVATED_BAN — это наш аккаунт, а не получатель
  if (isDeadAccountMailingError(errRaw)) return "dead_account";
  if (isPermanentMailingRecipientError(errRaw)) return "permanent";
  return "retry";
}

export function interpretMailingSendResult(
  result: MailingSendResult,
  account: Record<string, unknown>,
  deliveryMode: MailingDeliveryMode,
  now = Date.now(),
): MailingSendOutcome {
  const errRaw = String(result.error || "");
  const accountFrozen =
    result.status === "frozen" || /FROZEN|заморожен/i.test(errRaw);
  const peerFlood =
    result.status === "spamblock" ||
    isPeerFloodMailingError(errRaw) ||
    errRaw.includes("PEER_FLOOD");
  const rateLimited =
    !peerFlood &&
    !accountFrozen &&
    (result.status === "flood" ||
      !!result.flood ||
      Number(result.waitSec) > 0 ||
      Number(result.floodWait) > 0 ||
      isRateLimitMailingError(errRaw));

  if (rateLimited) {
    const waitSec = Math.max(
      60,
      Number(result.waitSec) || 0,
      Number(result.floodWait) || 0,
      parseMailingFloodWaitSec(errRaw, 900),
    );
    return {
      kind: "rate_limit",
      waitSec,
      accountPatch: { ...account, floodUntil: new Date(now + waitSec * 1000).toISOString() },
    };
  }
  if (accountFrozen) {
    return {
      kind: "frozen",
      accountPatch: withFrozenStatus(account, errRaw.slice(0, 500) || "FROZEN"),
    };
  }
  if (peerFlood) {
    const writeBan = WRITE_BAN_RE.test(errRaw);
    return {
      kind: "spamblock",
      writeBan,
      accountPatch: withSpamblockStatus(
        account,
        writeBan ? "WRITE_BAN_SUPERGROUPS" : errRaw.slice(0, 500) || "PEER_FLOOD",
      ),
    };
  }
  if (result.ok) {
    const bumped = creditMailingSend(account, deliveryMode);
    return { kind: "ok", bumped, wentDayCooldown: bumped.status === "cooldown" };
  }
  return { kind: "fail", failKind: classifyFailure(errRaw), error: errRaw.slice(0, 500) || "fail" };
}

/** Промахи «peer не виден сессии» по получателю: сколько раз и какими аккаунтами. */
export type PeerMissState = Record<string, { n: number; accounts: string[] }>;

export const MAILING_PEER_MISS_MAX = 3;

/** Учесть промах; permanent — после `max` попыток или когда все живые аккаунты уже пробовали. */
export function notePeerMiss(
  state: PeerMissState,
  key: string,
  accountId: string,
  liveIds: readonly string[],
  max = MAILING_PEER_MISS_MAX,
): { state: PeerMissState; permanent: boolean } {
  const prev = state[key] || { n: 0, accounts: [] };
  const accounts = prev.accounts.includes(accountId) ? prev.accounts : [...prev.accounts, accountId];
  const n = prev.n + 1;
  const permanent = n >= max || liveIds.every((id) => accounts.includes(id));
  const next = { ...state };
  if (permanent) delete next[key];
  else next[key] = { n, accounts };
  return { state: next, permanent };
}

/** Живые аккаунты, которыми этого получателя ещё не пробовали. */
export function untriedAccountIds(
  state: PeerMissState,
  key: string,
  liveIds: readonly string[],
): string[] {
  const tried = state[key]?.accounts || [];
  return liveIds.filter((id) => !tried.includes(id));
}

/** Ключ человека в реестре рассылок владельца (дедуп между задачами). */
export function mailingPersonKey(
  deliveryMode: MailingDeliveryMode,
  cand: { userId: string; username: string; leadId: string },
): string {
  if (deliveryMode === "chat") return cand.leadId ? `chat:lead:${cand.leadId}` : "";
  const key = recipientKey({
    sourceKind: "audience",
    userId: cand.userId,
    username: cand.username,
    leadId: cand.leadId,
  });
  return key ? `dm:${key}` : "";
}

/** Наш таймаут/abort: воркер мог успеть отправить — повторять нельзя. */
export function isAmbiguousSendError(e: unknown): boolean {
  const name = String((e as Error | null)?.name || "");
  return name === "TimeoutError" || name === "AbortError";
}
