/** Решения тика рассылки по ответу воркера. */

import {
  isPeerFloodMailingError,
  isRateLimitMailingError,
  parseMailingFloodWaitSec,
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

export type MailingSendOutcome =
  | { kind: "ok"; bumped: Record<string, unknown>; wentDayCooldown: boolean }
  | { kind: "rate_limit"; waitSec: number }
  | { kind: "spamblock"; accountPatch: Record<string, unknown> }
  | { kind: "frozen"; accountPatch: Record<string, unknown> }
  | { kind: "fail"; error: string };

export function interpretMailingSendResult(
  result: MailingSendResult,
  account: Record<string, unknown>,
  deliveryMode: "dm" | "chat",
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
    return {
      kind: "rate_limit",
      waitSec: Math.max(
        60,
        Number(result.waitSec) || 0,
        Number(result.floodWait) || 0,
        parseMailingFloodWaitSec(errRaw, 900),
      ),
    };
  }
  if (accountFrozen) {
    return {
      kind: "frozen",
      accountPatch: withFrozenStatus(account, errRaw || "Аккаунт заморожен Telegram"),
    };
  }
  if (peerFlood) {
    return {
      kind: "spamblock",
      accountPatch: withSpamblockStatus(
        account,
        /banned from sending|chat_write_forbidden/i.test(errRaw)
          ? "WRITE_BAN_SUPERGROUPS"
          : errRaw.slice(0, 500) || "PEER_FLOOD",
      ),
    };
  }
  if (result.ok) {
    const counters =
      deliveryMode === "chat"
        ? bumpChatCounters(account, 1)
        : bumpMessageCounters(account, 1);
    const bumped = applyQuotaCooldownIfExhausted({ ...account, ...counters });
    return {
      kind: "ok",
      bumped,
      wentDayCooldown: bumped.status === "cooldown",
    };
  }
  return { kind: "fail", error: errRaw.slice(0, 500) || "fail" };
}
