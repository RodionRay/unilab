/**
 * Owner notification bot (Telegram Bot API): conversation notices with buttons, inbound update parsing and the
 * HTTP call with the bot token redacted from every error. Pure helpers + one fetch wrapper; the workspace route
 * (app/api/workspace/route.ts) owns storage (message → lead map, getUpdates offset) and sending to clients.
 */

export const BOT_API_TIMEOUT_MS = 8_000;
/** callback_data of the «Ответить» button: `r:<leadId>` (≤64 bytes for a uuid). */
export const REPLY_CALLBACK_PREFIX = "r:";
/** Updates handled per poll: each reply may wait for a worker send, so a poll stays bounded. */
export const BOT_UPDATES_LIMIT = 5;
const TEXT_LIMIT = 3800;
const QUOTE_LIMIT = 1200;

/** `web_app` opens the mini app with signed initData; Telegram allows it in private chats only. */
export type InlineButton = { text: string; url?: string; callback_data?: string; web_app?: { url: string } };
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { force_reply: true; input_field_placeholder?: string; selective?: boolean };

export type BotResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string; status: number };

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Error text with the bot token removed (fetch errors quote the request URL `…/bot<token>/method`). */
export function redactToken(text: string, token: string): string {
  let out = String(text || "");
  if (token) out = out.split(token).join("***");
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***").slice(0, 300);
}

/**
 * Telegram rejects inline URL buttons that point at localhost / private hosts; such a cabinet address is
 * shown as a text link instead. Only https on a public host goes into a button.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) {
      return false;
    }
  }
  return !host.startsWith("[");
}

/** Deep link into the cabinet chat view; app/app/page.tsx opens the lead from `lead`. */
export function chatDeepLink(appBase: string, leadId: string): string {
  return `${appBase.replace(/\/$/, "")}/app?view=chats&lead=${encodeURIComponent(leadId)}`;
}

function cleanUsername(v: unknown): string {
  const u = String(v || "").replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{4,32}$/.test(u) ? u : "";
}

function cleanUserId(v: unknown): string {
  const id = String(v || "").replace(/^-/, "").trim();
  return /^\d{1,20}$/.test(id) ? id : "";
}

export type ConversationNotice = {
  event: "first_contact" | "client_reply";
  leadId: string;
  clientName: string;
  username: string;
  userId: string;
  /** Human source line: group «…», mailing «…» or the lead's source label. */
  source: string;
  accountName: string;
  text: string;
  appBase: string;
};

export type BuiltNotice = { html: string; plain: string; replyMarkup: ReplyMarkup };

/** HTML notice (+ plain-text fallback with the same facts) and its buttons. */
export function buildConversationNotice(n: ConversationNotice): BuiltNotice {
  const username = cleanUsername(n.username);
  const userId = cleanUserId(n.userId);
  const name = String(n.clientName || "").trim() || (username ? `@${username}` : "Клиент");
  const title = n.event === "first_contact" ? "Начата переписка" : "Клиент ответил";
  const quoteLabel = n.event === "first_contact" ? "Мы написали" : "Сообщение клиента";
  const text = String(n.text || "").trim().slice(0, QUOTE_LIMIT) || "[без текста]";
  const link = chatDeepLink(n.appBase, n.leadId);
  const publicLink = isPublicHttpsUrl(link);

  const who = username
    ? `${escapeHtml(name)} · <a href="https://t.me/${username}">@${username}</a>`
    : userId
      ? `<a href="tg://user?id=${userId}">${escapeHtml(name)}</a>`
      : escapeHtml(name);
  const html = [
    `<b>${title}</b>`,
    who,
    n.source ? `Источник: ${escapeHtml(n.source)}` : null,
    n.accountName ? `Аккаунт: ${escapeHtml(n.accountName)}` : null,
    "",
    `${quoteLabel}:`,
    `<blockquote>${escapeHtml(text)}</blockquote>`,
    publicLink ? null : `Чат в кабинете: ${escapeHtml(link)}`,
    "<i>Ответьте на это сообщение (Reply) или нажмите «Ответить» — текст уйдёт клиенту с этого же аккаунта.</i>",
  ].filter((line) => line !== null).join("\n").slice(0, TEXT_LIMIT);

  const plain = [
    title,
    username ? `${name} · @${username}` : name,
    n.source ? `Источник: ${n.source}` : "",
    n.accountName ? `Аккаунт: ${n.accountName}` : "",
    `${quoteLabel}: ${text}`,
    `Чат в кабинете: ${link}`,
    "Ответьте на это сообщение (Reply) — текст уйдёт клиенту.",
  ].filter(Boolean).join("\n").slice(0, TEXT_LIMIT);

  const firstRow: InlineButton[] = [];
  if (publicLink) firstRow.push({ text: "Открыть чат", url: link });
  if (username) firstRow.push({ text: "Написать в Telegram", url: `https://t.me/${username}` });
  const rows: InlineButton[][] = [];
  if (firstRow.length) rows.push(firstRow);
  rows.push([{ text: "Ответить", callback_data: `${REPLY_CALLBACK_PREFIX}${n.leadId}` }]);
  return { html, plain, replyMarkup: { inline_keyboard: rows } };
}

/** What one inbound update asks for, after the chat-id authorization. */
export type BotCommand =
  | { kind: "reply"; updateId: number; chatId: string; messageId: number; replyTo: number; text: string; inGroup: boolean; legacyNotice: boolean }
  | { kind: "reply_button"; updateId: number; chatId: string; callbackId: string; leadId: string }
  | { kind: "start"; updateId: number; chatId: string; messageId: number }
  | { kind: "hint"; updateId: number; chatId: string; messageId: number; reason: "no_reply_to" | "not_text" }
  | { kind: "callback_other"; updateId: number; callbackId: string }
  | { kind: "link"; updateId: number; chatId: string; messageId: number; tg: { id: number; username: string }; code: string }
  | { kind: "private_message"; updateId: number; chatId: string; messageId: number; tgUserId: number; start: boolean }
  | { kind: "private_callback"; updateId: number; callbackId: string; tgUserId: number }
  | { kind: "ignore"; updateId: number; reason: string };

/** `/start link_<code>` from a web settings link (REQ-L2); the code format is checked by the redeemer. */
const START_LINK_RE = /^\/start(?:@\w+)?\s+link_(\S{0,128})$/;
const START_RE = /^\/(start|help)(@\w+)?(\s|$)/;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);

/** Telegram user id of a human sender in a private chat, else 0. */
function privateSender(chat: Obj | null, from: Obj | null): number {
  if (chat?.type !== "private" || !from || from.is_bot === true) return 0;
  const id = Number(from.id);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/**
 * Private chats outside the configured notice chat (REQ-L2): link codes and member chatter. A link code is
 * accepted even in the configured chat (the owner's own private chat is often the notice chat).
 */
function parsePrivateMessage(updateId: number, msg: Obj, allowed: string): BotCommand | null {
  const chat = obj(msg.chat);
  const from = obj(msg.from);
  const tgUserId = privateSender(chat, from);
  if (!tgUserId) return null;
  const chatId = String(chat?.id ?? "");
  const messageId = Number(msg.message_id) || 0;
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  const link = START_LINK_RE.exec(text);
  if (link) return { kind: "link", updateId, chatId, messageId, tg: { id: tgUserId, username: cleanUsername(from?.username) }, code: link[1] ?? "" };
  if (allowed && chatId === allowed) return null;
  return { kind: "private_message", updateId, chatId, messageId, tgUserId, start: START_RE.test(text) };
}

/**
 * Maps a Bot API update to a command. The owner's configured chat (`allowedChatId`) gets the notice/reply
 * commands; other private chats get link / private_* commands; anything else (other groups, bots, other
 * update types) is ignored — the caller still advances the offset past it.
 */
export function parseBotUpdate(update: unknown, allowedChatId: string): BotCommand {
  const u = obj(update);
  const updateId = Number(u?.update_id);
  if (!u || !Number.isSafeInteger(updateId)) return { kind: "ignore", updateId: NaN, reason: "malformed" };
  const allowed = String(allowedChatId || "").trim();
  const cb = obj(u.callback_query);
  if (cb) {
    const callbackId = String(cb.id || "");
    const cbChat = obj(obj(cb.message)?.chat);
    const chatId = String(cbChat?.id ?? "");
    const cbSender = privateSender(cbChat, obj(cb.from));
    if (cbSender && chatId !== allowed) return { kind: "private_callback", updateId, callbackId, tgUserId: cbSender };
    if (!allowed || chatId !== allowed || obj(cb.from)?.is_bot === true) return { kind: "ignore", updateId, reason: "foreign_chat" };
    const data = String(cb.data || "");
    if (!data.startsWith(REPLY_CALLBACK_PREFIX)) return { kind: "callback_other", updateId, callbackId };
    return { kind: "reply_button", updateId, chatId, callbackId, leadId: data.slice(REPLY_CALLBACK_PREFIX.length).slice(0, 64) };
  }
  const msg = obj(u.message);
  if (!msg) return { kind: "ignore", updateId, reason: "unsupported" };
  const priv = parsePrivateMessage(updateId, msg, allowed);
  if (priv) return priv;
  const chatId = String(obj(msg.chat)?.id ?? "");
  if (!allowed || chatId !== allowed || obj(msg.from)?.is_bot === true) return { kind: "ignore", updateId, reason: "foreign_chat" };
  const messageId = Number(msg.message_id) || 0;
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (/^\/start(@\w+)?(\s|$)/.test(text) || /^\/help(@\w+)?(\s|$)/.test(text)) return { kind: "start", updateId, chatId, messageId };
  if (!text && !MEDIA_KEYS.some((k) => msg[k] != null)) return { kind: "ignore", updateId, reason: "service" };
  const replied = obj(msg.reply_to_message);
  const replyTo = Number(replied?.message_id) || 0;
  // A bot that is a group admin sees every message: staff chatter and replies to people are not addressed to it.
  const inGroup = obj(msg.chat)?.type === "group" || obj(msg.chat)?.type === "supergroup";
  if (inGroup && obj(replied?.from)?.is_bot !== true) return { kind: "ignore", updateId, reason: "group_chatter" };
  if (!text) return { kind: "hint", updateId, chatId, messageId, reason: "not_text" };
  if (!replyTo) return { kind: "hint", updateId, chatId, messageId, reason: "no_reply_to" };
  const legacyNotice = LEGACY_NOTICE_RE.test(String(replied?.text || ""));
  return { kind: "reply", updateId, chatId, messageId, replyTo, text: text.slice(0, 4000), inGroup, legacyNotice };
}

/** Message fields that carry content a manager might try to forward to a client (everything else is a service event). */
const MEDIA_KEYS = ["photo", "video", "document", "audio", "voice", "video_note", "sticker", "animation", "contact", "location", "venue", "poll", "dice"];
/** Plain-text notices of builds before the Reply button: never mapped to a lead, so a Reply cannot be routed. */
const LEGACY_NOTICE_RE = /^UniLab · (переписка|рассылка)(\s|$)/;

/** One Bot API call; never throws, never returns the token in `error`. */
export async function callBotApi<T = unknown>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = BOT_API_TIMEOUT_MS,
): Promise<BotResult<T>> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!r.ok || !data.ok) {
      return { ok: false, status: r.status, error: redactToken(String(data.description || `HTTP ${r.status}`), token) };
    }
    return { ok: true, result: data.result as T };
  } catch (e) {
    return { ok: false, status: 0, error: redactToken(String((e as Error)?.message || e), token) };
  }
}

/** Telegram's own words for «the owner never opened the bot / wrong chat id» → what to do. */
export function explainBotError(error: string): string {
  if (/chat not found|bot can't initiate|bot was blocked|user is deactivated|have no rights to send/i.test(error)) {
    return `${error} — откройте бота в Telegram и нажмите /start, проверьте chat id в Настройках`;
  }
  if (/unauthorized|not found$/i.test(error)) return `${error} — проверьте токен бота в Настройках`;
  if (/conflict.*webhook/i.test(error)) return `${error} — у бота включён webhook, отключите его (deleteWebhook)`;
  return error;
}

export type SendBotMessage = {
  html: string;
  plain?: string;
  replyMarkup?: ReplyMarkup;
  replyToMessageId?: number;
  timeoutMs?: number;
};

/**
 * sendMessage with HTML; when Telegram rejects the markup or a button (400), the same facts go once more as
 * plain text without buttons, so a notice is never lost to formatting.
 */
export async function sendBotMessage(
  token: string,
  chatId: string,
  m: SendBotMessage,
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const base: Record<string, unknown> = { chat_id: chatId, link_preview_options: { is_disabled: true } };
  if (m.replyToMessageId) base.reply_parameters = { message_id: m.replyToMessageId, allow_sending_without_reply: true };
  const timeoutMs = m.timeoutMs ?? BOT_API_TIMEOUT_MS;
  const first = await callBotApi<{ message_id?: number }>(token, "sendMessage", {
    ...base,
    text: m.html,
    parse_mode: "HTML",
    ...(m.replyMarkup ? { reply_markup: m.replyMarkup } : {}),
  }, timeoutMs);
  if (first.ok) return { ok: true, messageId: Number(first.result?.message_id) || 0 };
  if (first.status !== 400 || m.plain === undefined) return { ok: false, error: first.error };
  const keepForceReply = m.replyMarkup && "force_reply" in m.replyMarkup ? { reply_markup: m.replyMarkup } : {};
  const second = await callBotApi<{ message_id?: number }>(token, "sendMessage", { ...base, text: m.plain, ...keepForceReply }, timeoutMs);
  if (second.ok) return { ok: true, messageId: Number(second.result?.message_id) || 0 };
  return { ok: false, error: second.error };
}

/** A private chat that will never accept the bot's messages until the member acts (REQ-N2). */
export function isDmUndeliverable(error: string): boolean {
  return /forbidden|bot was blocked|chat not found|user is deactivated|bot can't initiate/i.test(error);
}

/** Per-chat menu button: the mini app, or Telegram's default (`url` empty). Never throws. */
export function setChatMenuButton(token: string, chatId: number, url: string, timeoutMs = BOT_API_TIMEOUT_MS) {
  const menu_button = url ? { type: "web_app", text: "UniLab", web_app: { url } } : { type: "default" };
  return callBotApi<boolean>(token, "setChatMenuButton", { chat_id: chatId, menu_button }, timeoutMs);
}

/** Private notice text; the sender adds the web_app «Открыть» button (lib/tma/bot-link.ts::sendDmNotices). */
export type PrivateNotice = { html: string; plain: string };

/**
 * Conversation notice for a member's private chat (REQ-N1): the group notice facts without the Reply
 * instruction, private replies are not routed to clients.
 */
export function buildPrivateConversationNotice(n: Omit<ConversationNotice, "appBase">): PrivateNotice {
  const username = cleanUsername(n.username);
  const name = String(n.clientName || "").trim() || (username ? `@${username}` : "Клиент");
  const title = n.event === "first_contact" ? "Начата переписка" : "Клиент ответил";
  const quoteLabel = n.event === "first_contact" ? "Мы написали" : "Сообщение клиента";
  const text = String(n.text || "").trim().slice(0, QUOTE_LIMIT) || "[без текста]";
  const who = username ? `${name} · @${username}` : name;
  const facts = [n.source ? `Источник: ${n.source}` : "", n.accountName ? `Аккаунт: ${n.accountName}` : ""].filter(Boolean);
  const html = [`<b>${title}</b>`, escapeHtml(who), ...facts.map(escapeHtml), "", `${quoteLabel}:`, `<blockquote>${escapeHtml(text)}</blockquote>`]
    .join("\n")
    .slice(0, TEXT_LIMIT);
  const plain = [title, who, ...facts, `${quoteLabel}: ${text}`].join("\n").slice(0, TEXT_LIMIT);
  return { html, plain };
}

/** New hot lead for a member's private chat (REQ-N1). */
export function buildPrivateLeadNotice(l: { name: string; source: string; message: string }): PrivateNotice {
  const name = String(l.name || "").trim() || "Лид";
  const message = String(l.message || "").replace(/\s+/g, " ").trim().slice(0, QUOTE_LIMIT) || "[без текста]";
  const source = String(l.source || "").trim().slice(0, 120);
  const html = ["<b>Горячий лид</b>", escapeHtml(name), source ? `Источник: ${escapeHtml(source)}` : null, `<blockquote>${escapeHtml(message)}</blockquote>`]
    .filter((line) => line !== null)
    .join("\n");
  const plain = ["Горячий лид", name, source ? `Источник: ${source}` : "", message].filter(Boolean).join("\n");
  return { html, plain };
}
