/**
 * Lead conversation state (Переписки): reply send outcome, incoming DM merge, inbox cursor, viewed mark.
 * Pure functions; app/api/workspace/route.ts does the I/O (send_lead_message, poll_dm_replies, mark_lead_viewed).
 */

export type SendStatus = "pending" | "sent" | "failed" | "unknown";

export type ReplyEntry = {
  text: string;
  mode: "dm" | "chat";
  at: string;
  ok: boolean;
  error: string;
  messageId: string;
  link: string;
  chatId: string;
  from: "us" | "client";
  status?: SendStatus;
  sendKey?: string;
  accountId?: string;
};

export type LeadData = Record<string, unknown> & { replies?: unknown };

export const MAX_REPLIES = 40;
/** A pending/unknown send blocks a repeat of the same message for this long (then it is treated as stale). */
export const SEND_BLOCK_WINDOW_MS = 15 * 60_000;
/** Inbox cursor stays this far behind the scan start: dialogs reorder while a scan runs, dedupe absorbs re-reads. */
export const INBOX_CURSOR_MARGIN_SEC = 120;

export function leadReplies(lead: LeadData): ReplyEntry[] {
  return Array.isArray(lead.replies) ? (lead.replies as ReplyEntry[]).filter(Boolean) : [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Patch applied when a manager opens the chat; null when there is nothing to change. */
export function markLeadOpened(
  lead: LeadData,
  nowIso: string,
): { viewed: true; viewedAt: string; needsManager: false } | null {
  if (lead.viewed && !lead.needsManager) return null;
  return { viewed: true, viewedAt: str(lead.viewedAt) || nowIso, needsManager: false };
}

export type SendBlock =
  | { kind: "delivered"; entry: ReplyEntry }
  | { kind: "inflight"; entry: ReplyEntry }
  | { kind: "unknown"; entry: ReplyEntry };

/**
 * Whether sending `text` now could duplicate an earlier attempt: the same client key already delivered,
 * or the same message (key, or text+mode) is still in flight / ended with an unknown result.
 */
export function findSendBlock(
  lead: LeadData,
  req: { clientMsgId: string; text: string; mode: "dm" | "chat" },
  nowMs: number,
): SendBlock | null {
  const ours = leadReplies(lead).filter((x) => x.from === "us");
  if (req.clientMsgId) {
    const delivered = ours.find((x) => x.sendKey === req.clientMsgId && x.ok);
    if (delivered) return { kind: "delivered", entry: delivered };
  }
  for (let i = ours.length - 1; i >= 0; i--) {
    const x = ours[i];
    if (x.status !== "pending" && x.status !== "unknown") continue;
    const at = Date.parse(x.at);
    if (!Number.isFinite(at) || nowMs - at > SEND_BLOCK_WINDOW_MS) continue;
    const same = req.clientMsgId
      ? x.sendKey === req.clientMsgId || (x.text === req.text && x.mode === req.mode)
      : x.text === req.text && x.mode === req.mode;
    if (same) return { kind: x.status === "pending" ? "inflight" : "unknown", entry: x };
  }
  return null;
}

/** Lead with a pending entry appended; a forced retry replaces the earlier unknown entry for the same message. */
export function withPendingSend(lead: LeadData, entry: ReplyEntry, replaceSendKey = ""): LeadData {
  const rest = leadReplies(lead).filter((x) => !(replaceSendKey && x.sendKey === replaceSendKey));
  return { ...lead, replies: [...rest, entry].slice(-MAX_REPLIES) };
}

export type SendOutcome = {
  status: Exclude<SendStatus, "pending">;
  error: string;
  messageId?: string;
  link?: string;
  chatId?: string;
  chatUsername?: string;
  senderAccessHash?: string;
};

/**
 * Applies a send result to the lead. Only a delivered message moves the conversation (account, viewed,
 * needsManager, status); only a delivered DM may refresh the client's peer fields — in chat mode the
 * worker answers with the group, not the client.
 */
export function applySendOutcome(
  lead: LeadData,
  ctx: { sendKey: string; mode: "dm" | "chat"; accountId: string; peerId: string; accessHash: string; nowIso: string },
  outcome: SendOutcome,
): LeadData {
  const sent = outcome.status === "sent";
  const replies = leadReplies(lead);
  const idx = replies.findIndex((x) => x.sendKey === ctx.sendKey);
  const base: ReplyEntry = idx >= 0
    ? replies[idx]
    : { text: "", mode: ctx.mode, at: ctx.nowIso, ok: false, error: "", messageId: "", link: "", chatId: "", from: "us" };
  const entry: ReplyEntry = {
    ...base,
    ok: sent,
    status: outcome.status,
    error: outcome.error.slice(0, 400),
    messageId: str(outcome.messageId).slice(0, 40),
    link: str(outcome.link).slice(0, 300),
    chatId: str(outcome.chatId || (ctx.mode === "dm" ? ctx.peerId : "")).slice(0, 40),
    accountId: ctx.accountId,
  };
  const nextReplies = idx >= 0
    ? replies.map((x, i) => (i === idx ? entry : x))
    : [...replies, entry].slice(-MAX_REPLIES);
  if (!sent) return { ...lead, replies: nextReplies };
  const next: LeadData = {
    ...lead,
    replies: nextReplies,
    status: lead.status === "new" ? "working" : lead.status,
    viewed: true,
    viewedAt: str(lead.viewedAt) || ctx.nowIso,
    conversationOpen: true,
    accountId: ctx.accountId,
    needsManager: false,
  };
  if (ctx.mode !== "dm") return next;
  return {
    ...next,
    senderId: str(outcome.chatId || ctx.peerId || lead.senderId).replace(/^-/, "").slice(0, 40),
    senderUsername: str(outcome.chatUsername || lead.senderUsername).slice(0, 64),
    senderAccessHash: str(outcome.senderAccessHash || ctx.accessHash).slice(0, 40),
  };
}

/** Telegram private-chat message ids are per account: the same id from another account is another message. */
export function hasIncomingDm(lead: LeadData, accountId: string, messageId: string): boolean {
  if (!messageId) return false;
  const legacyAccount = str(lead.accountId);
  return leadReplies(lead).some(
    (x) => x.from === "client" && str(x.messageId) === messageId && (str(x.accountId) || legacyAccount) === accountId,
  );
}

/**
 * Incoming DM merged into the freshly read lead; null when it is already recorded.
 * A closed (archived) lead keeps its status and temperature — the reply is recorded, not reopened.
 * The lead keeps its own account (replies go from it); only a legacy lead without one adopts `ctx.accountId`.
 */
export function mergeIncomingDm(
  lead: LeadData,
  incoming: ReplyEntry,
  ctx: { accountId: string; taskId: string; userId: string; username: string; nowIso: string },
): LeadData | null {
  if (hasIncomingDm(lead, ctx.accountId, incoming.messageId)) return null;
  const closed = lead.status === "archived";
  return {
    ...lead,
    replies: [...leadReplies(lead), { ...incoming, accountId: ctx.accountId }].slice(-MAX_REPLIES),
    status: closed ? lead.status : "working",
    temperature: closed ? lead.temperature : "hot",
    conversationOpen: true,
    conversationAt: ctx.nowIso,
    incomingLastText: incoming.text,
    needsManager: true,
    viewed: false,
    accountId: str(lead.accountId) || ctx.accountId,
    senderId: str(lead.senderId) || ctx.userId,
    senderUsername: str(lead.senderUsername) || ctx.username,
    mailingTaskId: str(lead.mailingTaskId) || ctx.taskId,
    draft: str(lead.draft),
  };
}

export type InboxCursor = { inboxSinceTs: number; inboxPageOffset: number; inboxPageStartTs: number };

/**
 * Next per-account inbox cursor. The floor (`inboxSinceTs`) only moves after a complete pass over every dialog
 * newer than it, and never past the start of that pass; an incomplete pass resumes from `nextOffsetDate`.
 */
export function nextInboxCursor(
  prev: { inboxSinceTs?: unknown; inboxPageOffset?: unknown; inboxPageStartTs?: unknown },
  result: { complete?: unknown; nextOffsetDate?: unknown; scanStartedTs?: unknown },
  fallbackTs: number,
): InboxCursor {
  const floor = Math.max(0, Number(prev.inboxSinceTs) || 0);
  const pageStart = Math.max(0, Number(prev.inboxPageStartTs) || 0);
  const scanStarted = Math.max(0, Number(result.scanStartedTs) || 0);
  const nextOffset = Math.max(0, Number(result.nextOffsetDate) || 0);
  if (result.complete === false && nextOffset > 0) {
    return { inboxSinceTs: floor, inboxPageOffset: nextOffset, inboxPageStartTs: pageStart || scanStarted };
  }
  const passStart = pageStart || scanStarted;
  const candidate = passStart ? passStart - INBOX_CURSOR_MARGIN_SEC : fallbackTs;
  return { inboxSinceTs: Math.max(floor, candidate), inboxPageOffset: 0, inboxPageStartTs: 0 };
}
