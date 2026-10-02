import type { D1LikeDatabase } from "@/lib/db";
import {
  isDmUndeliverable,
  isPublicHttpsUrl,
  sendBotMessage,
  setChatMenuButton,
  callBotApi,
  type BotCommand,
  type ReplyMarkup,
} from "@/lib/telegram-bot";
import { botIdFromToken } from "@/lib/tma/init-data";
import { miniAppUrl } from "@/lib/tma/link-api";
import { findActiveLink, listDmRecipients, redeemLinkCode, setDmError } from "@/lib/tma/links";
import { ensureTmaTables, getOrCreateWorkspaceKey } from "@/lib/tma/workspace";

/**
 * Bot side of the mini app: private-chat linking (REQ-L2/L5), member chatter, and private notices
 * (REQ-N1/N2). Called from the workspace bot poller and notify paths (app/api/workspace/route.ts).
 */

export const DM_CONCURRENCY = 5;
export const DM_TIMEOUT_MS = 5_000;
/** A notify call never spends longer than this on private notices; the rest are skipped. */
const DM_BUDGET_MS = 20_000;

const TEXT = {
  linked: "Telegram подключён к UniLab — откройте приложение кнопкой меню.",
  linkedNoHttps: "Telegram подключён к UniLab. Приложение откроется, когда у кабинета будет публичный адрес https.",
  invalid: "Ссылка недействительна или устарела — получите новую в настройках UniLab",
  rateLimited: "Слишком много попыток, попробуйте позже",
  onboarding: "Это бот уведомлений UniLab. Чтобы подключиться, нажмите «Подключить Telegram» в настройках UniLab.",
  help: "Вы подключены к UniLab. Лиды и переписки открываются в приложении: кнопка меню или «Открыть UniLab».",
  replyHint: "Ответьте клиенту в приложении — кнопка «Открыть»",
} as const;

export type PrivateBotCommand = Extract<BotCommand, { kind: "link" | "private_message" | "private_callback" }>;

export function isPrivateCommand(cmd: BotCommand): cmd is PrivateBotCommand {
  return cmd.kind === "link" || cmd.kind === "private_message" || cmd.kind === "private_callback";
}

/** Whether private updates matter for `owner`: a code waits for redemption or someone is linked. One query. */
export async function hasPrivateBotWork(db: D1LikeDatabase, owner: string, nowMs = Date.now()): Promise<boolean> {
  await ensureTmaTables(db);
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM tma_link_codes WHERE owner=? AND used_at IS NULL AND expires_at>?)
        OR EXISTS(SELECT 1 FROM tma_links WHERE owner=? AND revoked_at IS NULL) AS busy`,
    )
    .bind(owner, nowMs, owner)
    .first<{ busy: number }>();
  return Number(row?.busy) === 1;
}

/** `/tma/<wsKey>` of `owner` when `appBase` is public https (Telegram opens nothing else), else "". */
async function publicMiniAppUrl(db: D1LikeDatabase, owner: string, appBase: string): Promise<string> {
  if (!isPublicHttpsUrl(appBase)) return "";
  return miniAppUrl(appBase, await getOrCreateWorkspaceKey(db, owner));
}

async function say(token: string, chatId: string, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  const r = await sendBotMessage(token, chatId, { html: text, plain: text, ...(replyMarkup ? { replyMarkup } : {}) });
  if (!r.ok) console.error("[tma] bot_private_reply:", r.error.slice(0, 200));
}

async function redeemFromStart(db: D1LikeDatabase, owner: string, token: string, appBase: string, cmd: Extract<BotCommand, { kind: "link" }>) {
  const result = await redeemLinkCode(db, owner, cmd.code, cmd.tg, botIdFromToken(token));
  if (!result.ok) return say(token, cmd.chatId, result.reason === "rate_limited" ? TEXT.rateLimited : TEXT.invalid);
  const url = await publicMiniAppUrl(db, owner, appBase);
  if (!url) return say(token, cmd.chatId, TEXT.linkedNoHttps);
  const menu = await setChatMenuButton(token, cmd.tg.id, url);
  if (!menu.ok) console.error("[tma] menu_button:", menu.error.slice(0, 200));
  return say(token, cmd.chatId, TEXT.linked);
}

async function answerMember(db: D1LikeDatabase, owner: string, token: string, appBase: string, cmd: Extract<BotCommand, { kind: "private_message" }>) {
  if (!(await findActiveLink(db, owner, cmd.tgUserId))) return say(token, cmd.chatId, TEXT.onboarding);
  if (!cmd.start) return say(token, cmd.chatId, TEXT.replyHint);
  const url = await publicMiniAppUrl(db, owner, appBase);
  return say(token, cmd.chatId, TEXT.help, url ? { inline_keyboard: [[{ text: "Открыть UniLab", web_app: { url } }]] } : undefined);
}

/**
 * Acts on one private-chat update. Never routes anything to a client and never throws; replies carry
 * no workspace data unless the sender is an active linked member.
 */
export async function handlePrivateCommand(
  db: D1LikeDatabase,
  owner: string,
  token: string,
  appBase: string,
  cmd: PrivateBotCommand,
): Promise<void> {
  try {
    if (cmd.kind === "link") return await redeemFromStart(db, owner, token, appBase, cmd);
    if (cmd.kind === "private_message") return await answerMember(db, owner, token, appBase, cmd);
    await callBotApi(token, "answerCallbackQuery", { callback_query_id: cmd.callbackId, text: TEXT.replyHint });
  } catch (e) {
    console.error("[tma] bot_private:", String((e as Error)?.message || e).slice(0, 200));
  }
}

export type DmNotice = { leadId: string; html: string; plain: string };
type DmBuilt = { leadId: string; html: string; plain: string; replyMarkup: ReplyMarkup };

let warnedNoHttps = false;

/** Text stored on the link and shown in settings when Telegram refuses a private notice. */
function dmErrorText(error: string): string {
  return `Бот не может написать вам в Telegram (${error}). Откройте бота, нажмите /start и включите уведомления снова.`;
}

async function deliverTo(db: D1LikeDatabase, owner: string, token: string, tgUserId: number, notices: DmBuilt[], deadline: number) {
  for (const n of notices) {
    if (Date.now() > deadline) return;
    const sent = await sendBotMessage(token, String(tgUserId), {
      html: n.html,
      plain: n.plain,
      replyMarkup: n.replyMarkup,
      timeoutMs: DM_TIMEOUT_MS,
    });
    if (sent.ok) continue;
    console.error("[tma] dm_notice:", sent.error.slice(0, 200));
    if (isDmUndeliverable(sent.error)) await setDmError(db, owner, tgUserId, dmErrorText(sent.error));
    return;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * REQ-N1/N2: private copies of notices to opted-in linked members who can see leads, each with one
 * web_app «Открыть» button to `/tma/<wsKey>?lead=<id>` (the hash belongs to Telegram). Skipped unless
 * the app base is public https. Bounded concurrency and time; a blocked chat turns that member's opt-in
 * off. Never throws: callers send the group notice first and must not be failed by this.
 */
export async function sendDmNotices(
  db: D1LikeDatabase,
  owner: string,
  token: string,
  appBase: string,
  notices: DmNotice[],
): Promise<void> {
  try {
    if (!token || !notices.length) return;
    if (!isPublicHttpsUrl(appBase)) {
      if (!warnedNoHttps) console.warn("[tma] dm notices skipped: app base is not public https");
      warnedNoHttps = true;
      return;
    }
    const recipients = (await listDmRecipients(db, owner)).filter((r) => r.canSeeLeads);
    if (!recipients.length) return;
    const base = await publicMiniAppUrl(db, owner, appBase);
    const built: DmBuilt[] = notices.map((n) => ({
      ...n,
      replyMarkup: { inline_keyboard: [[{ text: "Открыть", web_app: { url: `${base}?lead=${encodeURIComponent(n.leadId)}` } }]] },
    }));
    const deadline = Date.now() + DM_BUDGET_MS;
    await eachLimited(recipients, DM_CONCURRENCY, (r) => deliverTo(db, owner, token, r.tgUserId, built, deadline));
  } catch (e) {
    console.error("[tma] dm_notices:", String((e as Error)?.message || e).slice(0, 200));
  }
}
