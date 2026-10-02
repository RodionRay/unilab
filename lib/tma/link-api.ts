import type { D1LikeDatabase } from "@/lib/db";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { resolveWorkspaceContext } from "@/lib/staff";
import type { WorkspaceContext } from "@/lib/staff-types";
import { callBotApi, setChatMenuButton } from "@/lib/telegram-bot";
import type { z } from "zod";
import type { LinkStatus, TmaError, linkRequestSchema } from "@/lib/tma/contract";
import { TMA_ERROR_TEXT } from "@/lib/tma/exchange";
import {
  LINK_START_PREFIX,
  TMA_LINK_RATE_LIMITS,
  createLinkCode,
  findActiveLinkForUser,
  revokeLink,
  setDmNotices,
} from "@/lib/tma/links";
import { getOrCreateWorkspaceKey, readWorkspaceBot, rememberBotIdentity } from "@/lib/tma/workspace";

/** POST /api/tma/link core (web cookie session): link code, status, unlink, DM opt-in. */

type LinkRequest = z.infer<typeof linkRequestSchema>;

export type LinkApiResult = { status: number; body: LinkStatus | TmaError; retryAfterSec?: number };

const NO_BOT = "Сначала подключите Telegram-бота уведомлений в настройках кабинета";
const BOT_DOWN = "Не удалось связаться с ботом. Проверьте токен бота в настройках кабинета.";
const NOT_YOUR_MEMBER = "Сотрудник не найден в этом кабинете";
const ONLY_ADMIN = "Отключить Telegram другого сотрудника может только владелец или администратор";

function fail(status: number, code: TmaError["code"], error = TMA_ERROR_TEXT[code]): LinkApiResult {
  return { status, body: { error, code } };
}

/** `${APP_URL}/tma/<wsKey>` only for a public https APP_URL (Telegram opens https only). */
export function miniAppUrl(appUrl: string | undefined, wsKey: string): string {
  const base = (appUrl || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^/\s]+/i.test(base) ? `${base}/tma/${wsKey}` : "";
}

async function linkStatus(db: D1LikeDatabase, owner: string, userId: string, appUrl: string): Promise<LinkStatus> {
  const link = await findActiveLinkForUser(db, owner, userId);
  return {
    linked: Boolean(link),
    tgUsername: link?.tgUsername ?? "",
    dmNotices: link?.dmNotices ?? false,
    dmError: link?.dmError ?? "",
    appUrl,
  };
}

async function createCode(db: D1LikeDatabase, ctx: WorkspaceContext, appUrl: string, clientIp: string | null): Promise<LinkApiResult> {
  const limit = await consumeRateLimits([
    [TMA_LINK_RATE_LIMITS.codePerUser, ctx.userId],
    [TMA_LINK_RATE_LIMITS.codePerUser, clientIp === null ? null : `ip:${clientIp}`],
  ]);
  if (!limit.allowed) return { ...fail(429, "rate_limited"), retryAfterSec: limit.retryAfterSec };
  const bot = await readWorkspaceBot(db, ctx.ownerId);
  if (!bot.token || !bot.botId) return fail(409, "workspace_unavailable", NO_BOT);
  const me = await callBotApi<{ username?: string }>(bot.token, "getMe", {});
  const username = me.ok ? String(me.result?.username || "") : "";
  if (!/^[A-Za-z0-9_]{5,64}$/.test(username)) return fail(502, "workspace_unavailable", BOT_DOWN);
  await rememberBotIdentity(db, ctx.ownerId, bot.botId, username);
  const { code, expiresAt } = await createLinkCode(db, ctx.ownerId, ctx.userId);
  const status = await linkStatus(db, ctx.ownerId, ctx.userId, appUrl);
  return {
    status: 200,
    body: { ...status, startLink: `https://t.me/${username}?start=${LINK_START_PREFIX}${code}`, expiresAt: Math.floor(expiresAt / 1000) },
  };
}

/** Self by default; owner/admin may unlink another member of the same workspace (admin: not the owner). */
async function unlinkTarget(ctx: WorkspaceContext, requested: string | undefined): Promise<{ ok: true; userId: string } | { ok: false; result: LinkApiResult }> {
  const target = requested?.trim() || ctx.userId;
  if (target === ctx.userId) return { ok: true, userId: target };
  if (!ctx.isOwner && ctx.role !== "admin") return { ok: false, result: fail(403, "forbidden", ONLY_ADMIN) };
  if (target === ctx.ownerId && !ctx.isOwner) return { ok: false, result: fail(403, "forbidden", ONLY_ADMIN) };
  if ((await resolveWorkspaceContext(target)).ownerId !== ctx.ownerId) return { ok: false, result: fail(404, "forbidden", NOT_YOUR_MEMBER) };
  return { ok: true, userId: target };
}

/** REQ-L4: the unlinked chat gets Telegram's default menu back. Best effort: never fails the unlink. */
async function resetMenuButton(db: D1LikeDatabase, owner: string, tgUserId: number): Promise<void> {
  try {
    const bot = await readWorkspaceBot(db, owner);
    if (!bot.token) return;
    const r = await setChatMenuButton(bot.token, tgUserId, "", 5_000);
    if (!r.ok) console.error("[tma] menu_reset:", r.error.slice(0, 200));
  } catch (e) {
    console.error("[tma] menu_reset:", String((e as Error)?.message || e).slice(0, 200));
  }
}

export async function handleLinkRequest(
  db: D1LikeDatabase,
  ctx: WorkspaceContext,
  req: LinkRequest,
  opts: { appUrl: string | undefined; clientIp: string | null },
): Promise<LinkApiResult> {
  const appUrl = miniAppUrl(opts.appUrl, await getOrCreateWorkspaceKey(db, ctx.ownerId));
  switch (req.action) {
    case "status":
      return { status: 200, body: await linkStatus(db, ctx.ownerId, ctx.userId, appUrl) };
    case "create_code":
      return createCode(db, ctx, appUrl, opts.clientIp);
    case "unlink": {
      const target = await unlinkTarget(ctx, req.userId);
      if (!target.ok) return target.result;
      const revoked = await revokeLink(db, ctx.ownerId, target.userId);
      if (revoked) await resetMenuButton(db, ctx.ownerId, revoked.tgUserId);
      return { status: 200, body: await linkStatus(db, ctx.ownerId, target.userId, appUrl) };
    }
    case "set_dm_notices": {
      if (typeof req.enabled !== "boolean") return fail(400, "bad_request");
      if (!(await setDmNotices(db, ctx.ownerId, ctx.userId, req.enabled))) return fail(409, "not_linked");
      return { status: 200, body: await linkStatus(db, ctx.ownerId, ctx.userId, appUrl) };
    }
    default:
      return fail(400, "bad_request");
  }
}
