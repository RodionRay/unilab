/**
 * «Переписки» view model: pure functions that turn a lead (source post + replies) into what the Telegram-style chat
 * UI renders — thread items with date separators, grouping, tick states, unread divider, and list-row summaries.
 * No React, no I/O; "now" is injectable so labels are testable. Dates are formatted in the local time zone.
 * UI: components/product/chats/*. Spec: docs/project/specs/tg-chat-ui.md.
 */
import { leadReplies, type LeadData, type ReplyEntry } from "@/lib/lead-conversation";

/** Consecutive messages of one side closer than this are drawn as one group (tail only on the last). */
export const GROUP_WINDOW_MS = 5 * 60_000;
/** Number of avatar colours (components map the index to `--chat-avatar-<n>`). */
export const AVATAR_TONES = 7;

export type ChatLead = { id: string; created?: string; data: LeadData };
export type ChatSide = "in" | "out";
export type TickState = "pending" | "sent" | "read" | "failed" | "unknown";

export type ThreadMessage = {
  kind: "message";
  key: string;
  side: ChatSide;
  text: string;
  at: string;
  /** HH:mm, local time; "" when the timestamp is missing. */
  time: string;
  /** The lead's source post (always first, theirs). */
  source: boolean;
  /** Outgoing only. */
  tick: TickState | null;
  error: string;
  /** Outgoing reply sent into the group: quote of the source post. */
  quote: string;
  mode: "dm" | "chat";
  messageId: string;
  chatId: string;
  link: string;
  first: boolean;
  last: boolean;
};
export type ThreadDate = { kind: "date"; key: string; label: string };
export type ThreadUnread = { kind: "unread"; key: string };
export type ThreadItem = ThreadMessage | ThreadDate | ThreadUnread;

export type BuildThreadOptions = {
  now?: Date;
  /**
   * Whether the chat counts as unread. Defaults to `!lead.data.viewed`; the UI passes the value captured at click
   * time because opening a chat marks it viewed in the same render.
   */
  unread?: boolean;
  /** An optimistic message being sent right now (shown with the clock tick). */
  pending?: { text: string; mode: "dm" | "chat"; at: string } | null;
};

export type ChatThread = { items: ThreadItem[]; unreadIndex: number };

const str = (v: unknown): string => (v == null ? "" : String(v));
const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(at: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatClock(iso: string): string {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });

/** Date separator: «Сегодня» · «Вчера» · «29 сентября» · «29 сентября 2025 г.» (other year). */
export function dateSeparatorLabel(iso: string, now: Date = new Date()): string {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const diff = daysBetween(d, now);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.getFullYear() === now.getFullYear() ? DAY_MONTH.format(d) : DAY_MONTH_YEAR.format(d);
}

/** List time: HH:mm today · «вчера» · short weekday within 7 days · dd.MM.yy. */
export function listTimeLabel(iso: string, now: Date = new Date()): string {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const diff = daysBetween(d, now);
  if (diff <= 0) return formatClock(iso);
  if (diff === 1) return "вчера";
  if (diff < 7) return WEEKDAY_SHORT.format(d).replace(".", "");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
}

export function tickOf(entry: ReplyEntry, replies: readonly ReplyEntry[]): TickState {
  if (!entry.ok) {
    if (entry.status === "pending") return "pending";
    if (entry.status === "unknown") return "unknown";
    return "failed";
  }
  const at = ms(entry.at);
  // No read receipts in the data: a client message after ours means they saw it.
  const answered = replies.some((r) => r.from === "client" && ms(r.at) > at);
  return answered ? "read" : "sent";
}

/**
 * The source post has no stored timestamp; the lead's creation (scan) time is the closest. It always precedes the
 * replies, so a creation time after the first reply (re-saved / imported lead) is not shown: the post is placed at
 * the first reply's time without a clock label.
 */
function sourceMessage(lead: ChatLead, firstReplyAt: string): ThreadMessage {
  const created = str(lead.data.messageAt) || str(lead.created);
  const late = !!firstReplyAt && !(ms(created) <= ms(firstReplyAt));
  const at = late ? firstReplyAt : created;
  return {
    kind: "message",
    key: `source-${lead.id}`,
    side: "in",
    text: str(lead.data.message),
    at,
    time: late ? "" : formatClock(at),
    source: true,
    tick: null,
    error: "",
    quote: "",
    mode: "chat",
    messageId: str(lead.data.tgMsgId),
    chatId: "",
    link: "",
    first: true,
    last: true,
  };
}

function replyMessage(entry: ReplyEntry, i: number, all: readonly ReplyEntry[], quote: string): ThreadMessage {
  const side: ChatSide = entry.from === "client" ? "in" : "out";
  return {
    kind: "message",
    key: `${entry.at}-${i}`,
    side,
    text: str(entry.text),
    at: str(entry.at),
    time: formatClock(str(entry.at)),
    source: false,
    tick: side === "out" ? tickOf(entry, all) : null,
    error: side === "out" ? str(entry.error) : "",
    quote: side === "out" && entry.mode === "chat" ? quote : "",
    mode: entry.mode === "chat" ? "chat" : "dm",
    messageId: str(entry.messageId),
    chatId: str(entry.chatId),
    link: str(entry.link),
    first: true,
    last: true,
  };
}

/** Index (into replies) of the first client message after our last outgoing one; -1 when there is none. */
function firstUnreadReply(replies: readonly ReplyEntry[]): number {
  let lastOurs = -1;
  replies.forEach((r, i) => {
    if (r.from !== "client") lastOurs = i;
  });
  return replies.findIndex((r, i) => i > lastOurs && r.from === "client");
}

/** Marks first/last of each run of same-side messages within GROUP_WINDOW_MS not split by a separator. */
function applyGrouping(items: ThreadItem[]): void {
  let prev: ThreadMessage | null = null;
  for (const item of items) {
    if (item.kind !== "message") {
      prev = null;
      continue;
    }
    const joined =
      prev !== null &&
      prev.side === item.side &&
      !prev.source &&
      !item.source &&
      Math.abs(ms(item.at) - ms(prev.at)) <= GROUP_WINDOW_MS;
    if (joined && prev) {
      prev.last = false;
      item.first = false;
    }
    prev = item;
  }
}

export function buildThread(lead: ChatLead, opts: BuildThreadOptions = {}): ChatThread {
  const now = opts.now ?? new Date();
  const replies = leadReplies(lead.data)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (ms(a.entry.at) || 0) - (ms(b.entry.at) || 0) || a.index - b.index)
    .map((x) => x.entry);
  const quote = str(lead.data.message);
  const unread = opts.unread ?? !lead.data.viewed;
  const unreadAt = unread ? firstUnreadReply(replies) : -1;

  const messages: ThreadMessage[] = [sourceMessage(lead, str(replies[0]?.at))];
  replies.forEach((entry, i) => messages.push(replyMessage(entry, i, replies, quote)));
  if (opts.pending?.text) {
    const p = opts.pending;
    messages.push({
      ...replyMessage(
        { text: p.text, mode: p.mode, at: p.at, ok: false, status: "pending", error: "", messageId: "", link: "", chatId: "", from: "us" },
        replies.length,
        replies,
        quote,
      ),
      key: `pending-${p.at}`,
    });
  }

  const items: ThreadItem[] = [];
  let unreadIndex = -1;
  let lastDay = "";
  messages.forEach((m, i) => {
    const day = dateSeparatorLabel(m.at, now);
    if (day && day !== lastDay) {
      items.push({ kind: "date", key: `date-${m.key}`, label: day });
      lastDay = day;
    }
    // messages[0] is the source post, so reply i-1 sits at messages[i]
    if (unreadAt >= 0 && i === unreadAt + 1) {
      unreadIndex = items.length;
      items.push({ kind: "unread", key: "unread" });
    }
    items.push(m);
  });
  applyGrouping(items);
  return { items, unreadIndex };
}

export type ChatListItem = {
  preview: string;
  /** «Вы: » / «Черновик: » / "" — rendered separately so it can be styled. */
  prefix: "" | "Вы: " | "Черновик: ";
  timeLabel: string;
  /** ISO of the last activity (sorting/tests). */
  at: string;
  unreadCount: number;
  failed: boolean;
  /** Tick of our last message when it is the last in the chat (list shows ✓/✓✓ like Telegram). */
  lastTick: TickState | null;
};

/** The draft counts only while it is not already one of our sent messages (the server stores the sent text as draft). */
export function unsentDraft(data: LeadData): string {
  const draft = str(data.draft).trim();
  if (!draft) return "";
  return leadReplies(data).some((r) => r.from === "us" && str(r.text).trim() === draft) ? "" : draft;
}

export function unreadCountOf(data: LeadData): number {
  if (data.viewed) return 0;
  const replies = leadReplies(data);
  if (!replies.some((r) => r.from === "client")) return 0;
  const first = firstUnreadReply(replies);
  const after = first < 0 ? 0 : replies.slice(first).filter((r) => r.from === "client").length;
  return Math.max(1, after);
}

export function chatListItem(lead: ChatLead, ctx: { now?: Date } = {}): ChatListItem {
  const now = ctx.now ?? new Date();
  const replies = leadReplies(lead.data);
  const last = replies.reduce<ReplyEntry | null>((acc, r) => (!acc || (ms(r.at) || 0) >= (ms(acc.at) || 0) ? r : acc), null);
  const unreadCount = unreadCountOf(lead.data);
  const draft = unsentDraft(lead.data);
  const lastOurs = [...replies].reverse().find((r) => r.from === "us") ?? null;
  const failed = !!lastOurs && tickOf(lastOurs, replies) === "failed";
  const at = str(last?.at) || str(lead.data.conversationAt) || str(lead.created);

  let prefix: ChatListItem["prefix"] = "";
  let preview: string;
  // A waiting client message beats the draft: the manager must see what was asked.
  if (draft && unreadCount === 0) {
    prefix = "Черновик: ";
    preview = draft;
  } else if (last) {
    prefix = last.from === "us" ? "Вы: " : "";
    preview = str(last.text);
  } else {
    preview = str(lead.data.incomingLastText) || str(lead.data.message);
  }
  return {
    preview: preview.replace(/\s+/g, " ").trim(),
    prefix,
    timeLabel: listTimeLabel(at, now),
    at,
    unreadCount,
    failed,
    lastTick: last && last.from === "us" && prefix !== "Черновик: " ? tickOf(last, replies) : null,
  };
}

/** Up to two initials from the first two words with letters: «Студия «Лён и хлопок»» → «СЛ». */
export function initials(name: string): string {
  const words = str(name)
    .split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => ch.toLowerCase() !== ch.toUpperCase() || /\d/.test(ch)).join(""))
    .filter(Boolean);
  const out = words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return out || "?";
}

/** Stable palette index 0..AVATAR_TONES-1 for an id (FNV-1a). */
export function avatarTone(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of str(id)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % AVATAR_TONES;
}

export type KeyLike = {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
};

/** Enter sends; Shift/Alt+Enter is a newline; never while an IME composition is open (keyCode 229 = Safari IME). */
export function isSendShortcut(e: KeyLike): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey) return false;
  if (e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return false;
  return true;
}
