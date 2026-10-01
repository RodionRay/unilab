import type { D1LikeDatabase } from "@/lib/db";
import type { WorkspaceActor } from "@/lib/security/workspace-authz";
import { resolveWorkspaceContext } from "@/lib/staff";
import { findLinkById } from "@/lib/tma/links";
import { verifyTmaToken } from "@/lib/tma/session";
import { readWorkspaceBot } from "@/lib/tma/workspace";

/**
 * Actor behind a tma bearer (REQ-A5). Every request re-checks what the token was minted on: the link
 * is still active and belongs to the same member/tg user/workspace, the workspace bot is still the
 * same bot, and the member still resolves to that workspace. Any mismatch → null (401), never a
 * fallback to another workspace.
 */
export async function resolveTmaActor(
  db: D1LikeDatabase,
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<WorkspaceActor | null> {
  try {
    const claims = await verifyTmaToken(token, nowSec);
    if (!claims) return null;
    const link = await findLinkById(db, claims.lnk);
    if (!link || link.revokedAt) return null;
    if (link.owner !== claims.own || link.userId !== claims.sub || link.tgUserId !== claims.tg) return null;
    const bot = await readWorkspaceBot(db, claims.own);
    if (!bot.botId || bot.botId !== claims.bot) return null;
    const ctx = await resolveWorkspaceContext(claims.sub);
    if (ctx.ownerId !== claims.own) return null;
    return {
      userId: claims.sub,
      ownerId: ctx.ownerId,
      isOwner: ctx.isOwner,
      role: ctx.role,
      access: ctx.access,
      channel: "tma",
    };
  } catch (e) {
    console.error("[tma] resolve actor:", String((e as Error)?.message || e).slice(0, 300));
    return null;
  }
}
