/**
 * Решения скана групп (app/api/workspace/route.ts::scan_group): гейт аккаунта, tombstones, серверные поля.
 * Отбор лидов — lib/leads (судья проекта), память отказов AI — lib/leads/reject-memory.ts.
 */

import { dayLimitCooldownKind, isDayLimitCooldown, isAccountUsable } from "@/lib/telegram-accounts";

export type ScanGateResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hard_dead" | "missing"; waitSec?: number; message: string };

const HARD_DEAD = new Set([
  "disconnected",
  "unauthorized",
  "frozen",
  "spamblock",
  "proxy_error",
]);

/** Можно ли сканить группу с этого аккаунта. */
export function evaluateScanGate(account: {
  status?: string | null;
  cooldownUntil?: string | null;
  cooldownReason?: unknown;
} | null): ScanGateResult {
  if (!account) {
    return { ok: false, reason: "missing", message: "Аккаунт группы не найден" };
  }
  const st = String(account.status || "");
  // Чтение группы — не лимитируемый вид: дневной лимит ЛС/вступлений скан не останавливает
  const blockingCooldown = isDayLimitCooldown(account) && dayLimitCooldownKind(account) === null;
  if (blockingCooldown || st === "spamblock" || st === "frozen") {
    const until = String(account.cooldownUntil || "");
    const waitSec = Math.max(
      60,
      Math.ceil((Date.parse(until) - Date.now()) / 1000) || 300,
    );
    return {
      ok: false,
      reason: "cooldown",
      waitSec,
      message: "Аккаунт на отлёжке — скан позже",
    };
  }
  if (HARD_DEAD.has(st) || !isAccountUsable(account)) {
    return {
      ok: false,
      reason: "hard_dead",
      message: "Аккаунт недоступен — нужна пересадка",
    };
  }
  return { ok: true };
}

/** REQ-L6: message ids of leads the user deleted; the scan dedupe treats them as existing. */
export const MAX_LEAD_TOMBSTONES = 2000;

export function addLeadTombstone(list: unknown, tgMsgId: string): string[] {
  const prev = Array.isArray(list) ? list.map(String) : [];
  if (!tgMsgId || prev.includes(tgMsgId)) return prev;
  return [...prev, tgMsgId].slice(-MAX_LEAD_TOMBSTONES);
}

/**
 * REQ-L10 / REQ-L7 / lead core v2 REQ-24: fields the server owns; a client save (stale copy or
 * zod-stripped) never overwrites or introduces them. Lead: conversation, sender, scan and judge data.
 * Group: scan lock, cursor, memories, project. Settings: DM inbox cursor and DM AI-reject memory.
 */
const SERVER_OWNED: Record<"lead" | "group" | "settings", readonly string[]> = {
  lead: [
    "replies", "needsManager", "incomingLastText", "conversationOpen", "conversationAt",
    "coreScore", "notifyPending", "notifiedAt", "notifyAttempts", "notifyClaimUntil",
    "senderId", "senderUsername", "senderAccessHash", "peerId", "replyToMsgId", "messageKind",
    "tgMsgId", "groupId", "accountId", "mailingTaskId",
    "projectId", "score", "reason", "sourceKind", "draftKind", "feedback",
  ],
  group: ["scanLockUntil", "scanLockToken", "scanCursor", "aiRejected", "leadTombstones", "projectId"],
  settings: ["inboxPollCursor", "dmAiRejected"],
};

function isServerOwnedKind(kind: string): kind is keyof typeof SERVER_OWNED {
  return Object.prototype.hasOwnProperty.call(SERVER_OWNED, kind);
}

export function keepServerOwnedFields(
  kind: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const fields = isServerOwnedKind(kind) ? SERVER_OWNED[kind] : [];
  const out = { ...next };
  for (const f of fields) {
    // Missing in the stored row → still not the client's to set (sender, peer, account …).
    if (f in prev) out[f] = prev[f];
    else delete out[f];
  }
  return out;
}
