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
export const AVATAR_TONES = 10;

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
  /** Failed and not yet superseded by a later delivered / in-flight copy of the same text+mode. */
  retryable: boolean;
  /** The stored reply (null for the source post) — lets a host render statuses it adds (e.g. deferred replies). */
  entry: ReplyEntry | null;
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
  pending?: { text: string; mode: "dm" | "chat"; at: string; retry?: boolean } | null;
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
const sameText = (a: string, b: string) => a.trim() === b.trim();

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
  // hosts with deferred replies: a waiting one is «on its way», a cancelled one never failed
  const status = String(entry.status ?? "");
  if (status === "scheduled") return "pending";
  if (status === "cancelled") return "unknown";
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
  // msgAt = the post's own Telegram time where the scanner stores it
  const created = str(lead.data.msgAt) || str(lead.data.messageAt) || str(lead.created);
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
    retryable: false,
    entry: null,
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
    retryable: false,
    entry,
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

/** A failed message can be retried unless a later copy (same text+mode) was delivered or is in flight. */
function markRetryable(messages: ThreadMessage[]): void {
  messages.forEach((m, i) => {
    if (m.tick !== "failed") return;
    m.retryable = !messages.some(
      (later, j) => j > i && later.side === "out" && later.tick !== "failed" && later.mode === m.mode && sameText(later.text, m.text),
    );
  });
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
  const p = opts.pending;
  // a retry turns the failed bubble itself into «sending» instead of adding a second copy
  const retried = p?.retry
    ? messages.findLastIndex((m) => m.side === "out" && m.tick === "failed" && m.mode === p.mode && sameText(m.text, p.text))
    : -1;
  if (p && retried >= 0) {
    messages[retried] = { ...messages[retried]!, tick: "pending", error: "" };
  } else if (p?.text) {
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

  markRetryable(messages);

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
  // a cancelled deferred reply never reached the client: not the chat's last message
  const live = replies.filter((r) => String(r.status ?? "") !== "cancelled");
  const last = live.reduce<ReplyEntry | null>((acc, r) => (!acc || (ms(r.at) || 0) >= (ms(acc.at) || 0) ? r : acc), null);
  const unreadCount = unreadCountOf(lead.data);
  const draft = unsentDraft(lead.data);
  const lastOurs = [...live].reverse().find((r) => r.from === "us") ?? null;
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

/** Stable palette index 0..AVATAR_TONES-1 for an id (FNV-1a + murmur3 finalizer so similar UUIDs spread). */
export function avatarTone(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of str(id)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
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

// ---------------------------------------------------------------------------------------------------------------
// Panel state rules (kept pure so they are testable without React)

/** A message the manager just sent; shown with the clock tick until the server stores it. */
export type Outbox = {
  leadId: string;
  text: string;
  mode: "dm" | "chat";
  at: string;
  /** How many of our replies with this text existed when it was sent (server clocks may differ from ours). */
  known: number;
  /** Resend of a failed message: shown in place of that bubble until the request settles. */
  retry: boolean;
};

function ourCopies(data: LeadData, text: string): number {
  return leadReplies(data).filter((r) => r.from === "us" && sameText(str(r.text), text)).length;
}

export function makeOutbox(
  lead: ChatLead,
  text: string,
  mode: "dm" | "chat",
  opts: { now?: Date; retry?: boolean } = {},
): Outbox {
  const clean = text.trim();
  const at = (opts.now ?? new Date()).toISOString();
  return { leadId: lead.id, text: clean, mode, at, known: ourCopies(lead.data, clean), retry: !!opts.retry };
}

/** The outbox still needs its own bubble: same chat and the server has not stored a new copy of the text yet. */
export function pendingFor(outbox: Outbox | null, lead: ChatLead | null): BuildThreadOptions["pending"] {
  if (!outbox || !lead || outbox.leadId !== lead.id) return null;
  // a retry replaces the failed entry server-side (copy count unchanged): it ends when the request settles
  if (outbox.retry) return { text: outbox.text, mode: outbox.mode, at: outbox.at, retry: true };
  if (ourCopies(lead.data, outbox.text) > outbox.known) return null;
  return { text: outbox.text, mode: outbox.mode, at: outbox.at };
}

/** Where a chat was opened from: lets the list keep it in place while nothing else changed. */
export type OpenedFrom = { id: string; unread: boolean; index: number; query: string; folder: string };

export function openedFrom(lead: ChatLead, leads: readonly ChatLead[], query: string, folder: string): OpenedFrom {
  return { id: lead.id, unread: !lead.data.viewed, index: leads.findIndex((l) => l.id === lead.id), query, folder };
}

/**
 * Opening a «Новые» chat marks it viewed, which moves it to «Просмотренные». Like Telegram's unread folder the row
 * stays in place while that chat is open — but only while the search and folder are the ones it was opened from.
 */
export function listWithOpened(
  leads: readonly ChatLead[],
  active: ChatLead | null,
  opened: OpenedFrom | null,
  current: { query: string; folder: string },
): readonly ChatLead[] {
  if (!active || !opened || opened.id !== active.id || opened.index < 0) return leads;
  if (opened.query !== current.query || opened.folder !== current.folder) return leads;
  if (leads.some((l) => l.id === active.id)) return leads;
  const next = [...leads];
  next.splice(Math.min(opened.index, next.length), 0, active);
  return next;
}

/** Unread state for the thread: captured at click time (opening marks the lead viewed in the same render). */
export function unreadOnOpen(active: ChatLead, opened: OpenedFrom | null): boolean {
  return opened && opened.id === active.id ? opened.unread : !active.data.viewed;
}

/** Default composer mode for a chat: DM when the client is reachable there, else a reply in the group. */
export function defaultMode(data: LeadData, chatAvailable: boolean): "dm" | "chat" {
  const dm = !!(data.senderId || data.senderUsername);
  return dm || !chatAvailable ? "dm" : "chat";
}

export type SendErrorView = { text: string; code: string };

const SEND_ERRORS: Record<string, string> = {
  PEER_FLOOD: "Telegram временно ограничил этот аккаунт для новых диалогов. Ответьте позже или в группе.",
  USER_PRIVACY_RESTRICTED: "Клиент закрыл личные сообщения. Ответьте в группе.",
  USER_IS_BLOCKED: "Клиент заблокировал аккаунт. Ответьте в группе или с другого аккаунта.",
  INPUT_USER_DEACTIVATED: "Аккаунт клиента удалён. Отправить сообщение нельзя.",
  CHAT_WRITE_FORBIDDEN: "Этому аккаунту запрещено писать в группе. Ответьте в личку.",
  USER_BANNED_IN_CHANNEL: "Аккаунт ограничен в этой группе. Ответьте в личку.",
};

function waitLabel(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const min = Math.ceil(sec / 60);
  return min < 60 ? `${min} мин` : `${Math.ceil(min / 60)} ч`;
}

/**
 * Plain-Russian text for a failed send with the next step; the raw Telegram code goes to a tooltip.
 * Server messages without a Telegram code (already Russian) are shown as they are.
 */
export function describeSendError(raw: string): SendErrorView {
  const text = str(raw).trim();
  if (!text) return { text: "Не отправлено. Повторите попытку.", code: "" };
  const flood = text.match(/FLOOD_WAIT_(\d+)/);
  if (flood) {
    return { text: `Telegram просит подождать ${waitLabel(Number(flood[1]))}. Повторите после паузы.`, code: flood[0] };
  }
  const code = text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/)?.[0] ?? "";
  if (!code) return { text, code: "" };
  return { text: SEND_ERRORS[code] ?? "Telegram отклонил сообщение. Повторите позже или ответьте другим способом.", code };
}
