import type { D1LikeDatabase } from "@/lib/db";
import { consumeRateLimit, peekRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { resolveWorkspaceContext } from "@/lib/staff";
import { CRM_ACCESS_KEYS } from "@/lib/staff-types";
import { ensureUserTables } from "@/lib/users";
import type { SessionRequest, SessionResponse, TmaErrorCode } from "@/lib/tma/contract";
import { verifyInitData } from "@/lib/tma/init-data";
import { resolveTelegramLink } from "@/lib/tma/links";
import { issueTmaToken } from "@/lib/tma/session";
import { botLinkFor, findWorkspaceByKey, readWorkspaceBot } from "@/lib/tma/workspace";

/** User-facing (Russian) text per error code; neutral — never says which check failed beyond the code. */
export const TMA_ERROR_TEXT: Readonly<Record<TmaErrorCode, string>> = {
  bad_request: "Некорректный запрос",
  invalid_init_data: "Не удалось проверить запуск из Telegram. Откройте приложение из бота заново.",
  init_data_expired: "Данные запуска устарели. Откройте приложение из бота заново.",
  session_expired: "Сессия истекла — откройте заново из бота",
  not_linked: "Этот Telegram не подключён к кабинету. Подключите его в настройках кабинета и откройте приложение из бота.",
  workspace_unavailable: "Приложение недоступно. Обратитесь к владельцу кабинета.",
  forbidden: "Нет доступа к этому разделу",
  rate_limited: "Слишком много попыток. Попробуйте позже.",
  unavailable: "Сервис временно недоступен. Повторите попытку.",
};

/**
 * REQ-A8: POST /api/tma/session per client IP (every attempt, counted before any HMAC work) and per
 * workspace key (only failures behind a valid HMAC, so neither members' own launches nor a stranger's
 * junk/forged initData lock the members out).
 */
export const TMA_SESSION_RATE_LIMITS = {
  perIp: { name: "tma-session-ip", limit: 30, windowSec: 900 },
  failedPerWsKey: { name: "tma-session-ws-fail", limit: 300, windowSec: 900 },
} as const satisfies Record<string, RateLimitRule>;

export type ExchangeResult =
  | { ok: true; body: SessionResponse }
  | { ok: false; status: 401 | 403 | 429; code: TmaErrorCode; botLink?: string; retryAfterSec?: number };

async function memberName(db: D1LikeDatabase, userId: string, fallback: string): Promise<string> {
  await ensureUserTables();
  const row = await db.prepare("SELECT name FROM users WHERE id=?").bind(userId).first<{ name: unknown }>();
  return String(row?.name || fallback || "Сотрудник").slice(0, 120);
}

/**
 * POST /api/tma/session core (REQ-A1–A4, A9): wsKey → workspace + its current bot token → initData
 * HMAC/freshness → link of (owner, tg user) → member still in this workspace → bearer.
 */
export async function exchangeInitData(db: D1LikeDatabase, req: SessionRequest): Promise<ExchangeResult> {
  const ws = await findWorkspaceByKey(db, req.wsKey);
  if (!ws) return { ok: false, status: 403, code: "workspace_unavailable" };
  const bot = await readWorkspaceBot(db, ws.owner);
  if (!bot.token || !bot.botId) return { ok: false, status: 403, code: "workspace_unavailable" };

  const verified = await verifyInitData(req.initData, bot.token);
  if (!verified.ok) return { ok: false, status: 401, code: verified.code };

  const tg = { id: verified.user.id, username: verified.user.username };
  const notLinked: ExchangeResult = { ok: false, status: 403, code: "not_linked", botLink: botLinkFor(ws, bot.botId) };
  const link = await resolveTelegramLink(db, ws.owner, tg, bot.botId);
  if (!link) return notLinked;
  const ctx = await resolveWorkspaceContext(link.userId);
  if (ctx.ownerId !== ws.owner) return notLinked;

  const { token, expiresAt } = await issueTmaToken({
    sub: link.userId,
    own: ws.owner,
    tg: tg.id,
    bot: bot.botId,
    lnk: link.id,
  });
  const fullAccess = ctx.isOwner || ctx.role === "admin";
  const access = CRM_ACCESS_KEYS.filter((k) => (fullAccess ? k !== "staff" || ctx.isOwner : ctx.access[k]));
  return {
    ok: true,
    body: {
      token,
      expiresAt,
      me: { name: await memberName(db, link.userId, verified.user.firstName), role: ctx.role, access },
      workspace: { name: bot.workspaceName || "Кабинет" },
    },
  };
}

/** Failures that passed the bot-token HMAC: a stranger without the token cannot produce them. */
const AUTHENTIC_FAILURES: ReadonlySet<TmaErrorCode> = new Set<TmaErrorCode>(["not_linked", "init_data_expired"]);

/** exchangeInitData behind the per-wsKey limit: blocked once the window holds too many authentic failures. */
export async function exchangeWithinWsKeyLimit(db: D1LikeDatabase, req: SessionRequest, nowMs = Date.now()): Promise<ExchangeResult> {
  const rule = TMA_SESSION_RATE_LIMITS.failedPerWsKey;
  const room = await peekRateLimit(rule, req.wsKey, nowMs);
  if (!room.allowed) return { ok: false, status: 429, code: "rate_limited", retryAfterSec: room.retryAfterSec };
  const result = await exchangeInitData(db, req);
  if (!result.ok && AUTHENTIC_FAILURES.has(result.code)) await consumeRateLimit(rule, req.wsKey, nowMs);
  return result;
}
