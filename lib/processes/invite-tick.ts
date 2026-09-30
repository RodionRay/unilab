/** Решения тика инвайтинга (чистая логика). */

import {
  applyQuotaCooldownIfExhausted,
  hasMemberInviteQuota,
  isAccountUsable,
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
  results?: InviteWorkerUserResult[];
};

export type InviteTickOutcome =
  | { kind: "spamblock"; accountPatch: Record<string, unknown> }
  | { kind: "frozen"; accountPatch: Record<string, unknown> }
  | { kind: "flood"; waitSec: number }
  | {
      kind: "batch";
      okN: number;
      failN: number;
      accountPatch?: Record<string, unknown>;
      wentCooldown: boolean;
    };

/** Интерпретация /invite-users: spam/freeze/flood или успешный батч + квота. */
export function interpretInviteWorkerResult(
  result: InviteWorkerResult,
  account: Record<string, unknown>,
  okBump = true,
): InviteTickOutcome {
  const err = String(result.error || "");
  if (result.status === "spamblock" || err.includes("PEER_FLOOD")) {
    return {
      kind: "spamblock",
      accountPatch: withSpamblockStatus(account, "PEER_FLOOD"),
    };
  }
  if (result.status === "frozen") {
    return {
      kind: "frozen",
      accountPatch: withFrozenStatus(account, err || "Аккаунт заморожен"),
    };
  }
  if (result.status === "floodwait" || Number(result.floodWait) > 0) {
    return {
      kind: "flood",
      waitSec: Math.max(60, Number(result.floodWait) || 900),
    };
  }

  let okN = 0;
  let failN = 0;
  for (const r of result.results || []) {
    if (r.ok) okN++;
    else failN++;
  }

  if (okBump && okN > 0) {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const prev =
      account.memberInviteDay === day ? Number(account.memberInvitesToday) || 0 : 0;
    const bumped = applyQuotaCooldownIfExhausted({
      ...account,
      memberInviteDay: day,
      memberInvitesToday: prev + okN,
    });
    return {
      kind: "batch",
      okN,
      failN,
      accountPatch: bumped,
      wentCooldown: bumped.status === "cooldown",
    };
  }

  return { kind: "batch", okN, failN, wentCooldown: false };
}

/** Жив ли слот для следующего тика инвайта. */
export function inviteAccountStillLive(
  account: Parameters<typeof isAccountUsable>[0],
  wentCooldown: boolean,
): boolean {
  if (wentCooldown) return false;
  if (!isAccountUsable(account)) return false;
  return hasMemberInviteQuota(account as Parameters<typeof hasMemberInviteQuota>[0]);
}
