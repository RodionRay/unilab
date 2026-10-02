import type { D1LikeDatabase } from "@/lib/db";
import { consumeRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { ensureStaffTables, resolveWorkspaceContext } from "@/lib/staff";
import { parseAccess, STAFF_ROLES, type StaffRole } from "@/lib/staff-types";
import { ensureUserTables } from "@/lib/users";
import { ensureTmaTables } from "@/lib/tma/workspace";

/**
 * Telegram user ↔ workspace member links (REQ-L1–L5). Verified sources only: a single-use code
 * redeemed in the bot's private chat, or a Login-Widget `oauth_accounts` row (REQ-L3). Never from
 * initData alone. At most one active link per (owner, tg user) and per (owner, member).
 */

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const LINK_START_PREFIX = "link_";
const CODE_RE = /^[A-Za-z0-9_-]{32,64}$/;

export const TMA_LINK_RATE_LIMITS = {
  /** create_code per member. */
  codePerUser: { name: "tma-code-user", limit: 10, windowSec: 3600 },
  /**
   * Redemption attempts per Telegram user in a workspace (REQ-A8). No per-workspace cap: any stranger could
   * fill it and lock members out, while 192-bit single-use codes make guessing hopeless anyway.
   */
  redeemPerTgUser: { name: "tma-redeem-tg", limit: 10, windowSec: 900 },
} as const satisfies Record<string, RateLimitRule>;

export type TmaLink = {
  id: string;
  owner: string;
  userId: string;
  tgUserId: number;
  tgUsername: string;
  botId: string;
  dmNotices: boolean;
  dmError: string;
  created: string;
  revokedAt: string | null;
};

export type TelegramIdentity = { id: number; username: string };

export type RedeemResult =
  | { ok: true; userId: string; linkId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "foreign" | "rate_limited" };

function rowLink(row: Record<string, unknown> | null): TmaLink | null {
  if (!row) return null;
  return {
    id: String(row.id),
    owner: String(row.owner),
    userId: String(row.user_id),
    tgUserId: Number(row.tg_user_id),
    tgUsername: String(row.tg_username || ""),
    botId: String(row.bot_id || ""),
    dmNotices: Number(row.dm_notices) === 1,
    dmError: String(row.dm_error || ""),
    created: String(row.created || ""),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

/** Single-use code for `/start link_<code>`: 24 random bytes (192 bit), stored only as its sha256. */
export async function createLinkCode(
  db: D1LikeDatabase,
  owner: string,
  userId: string,
  nowMs = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  await ensureTmaTables(db);
  const code = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const expiresAt = nowMs + LINK_CODE_TTL_MS;
  await db.prepare("DELETE FROM tma_link_codes WHERE expires_at < ?").bind(nowMs - 86_400_000).run();
  await db
    .prepare("INSERT INTO tma_link_codes (code_hash,owner,user_id,expires_at,used_at,created) VALUES (?,?,?,?,?,?)")
    .bind(await sha256Hex(code), owner, userId, expiresAt, null, new Date(nowMs).toISOString())
    .run();
  return { code, expiresAt };
}

/** Why a code could not be claimed; looked up only after the atomic claim failed. */
async function classifyUnclaimed(
  db: D1LikeDatabase,
  owner: string,
  codeHash: string,
  nowMs: number,
): Promise<"invalid" | "expired" | "used" | "foreign"> {
  const row = await db
    .prepare("SELECT owner, expires_at, used_at FROM tma_link_codes WHERE code_hash=?")
    .bind(codeHash)
    .first<{ owner: string; expires_at: number; used_at: number | null }>();
  if (!row) return "invalid";
  if (row.owner !== owner) return "foreign";
  if (row.used_at != null) return "used";
  return Number(row.expires_at) <= nowMs ? "expired" : "invalid";
}

async function insertLink(db: D1LikeDatabase, owner: string, userId: string, tg: TelegramIdentity, botId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tma_links (id,owner,user_id,tg_user_id,tg_username,bot_id,dm_notices,dm_error,created,revoked_at)
       VALUES (?,?,?,?,?,?,0,'',?,NULL)`,
    )
    .bind(id, owner, userId, String(tg.id), tg.username.slice(0, 64), botId, new Date().toISOString())
    .run();
  return id;
}

/**
 * Binds `tg` to `userId` in `owner`: an identical active link is kept (live sessions stay valid);
 * any other active link of this member or this tg user in the workspace is revoked first.
 */
async function bindLink(db: D1LikeDatabase, owner: string, userId: string, tg: TelegramIdentity, botId: string): Promise<string> {
  const same = rowLink(
    await db
      .prepare("SELECT * FROM tma_links WHERE owner=? AND user_id=? AND tg_user_id=? AND revoked_at IS NULL")
      .bind(owner, userId, String(tg.id))
      .first(),
  );
  if (same) {
    await db.prepare("UPDATE tma_links SET tg_username=?, bot_id=? WHERE id=?").bind(tg.username.slice(0, 64), botId, same.id).run();
    return same.id;
  }
  const revokeOthers = () =>
    db
      .prepare("UPDATE tma_links SET revoked_at=? WHERE owner=? AND revoked_at IS NULL AND (user_id=? OR tg_user_id=?)")
      .bind(new Date().toISOString(), owner, userId, String(tg.id))
      .run();
  await revokeOthers();
  try {
    return await insertLink(db, owner, userId, tg, botId);
  } catch {
    // A concurrent bind of the same member/tg won the partial unique index: revoke it and retry once.
    await revokeOthers();
    return insertLink(db, owner, userId, tg, botId);
  }
}

/**
 * Redeems `/start link_<code>` received by the workspace bot from `tg` (REQ-L2/L5). Single use: the
 * claim is one conditional UPDATE. Never throws for bad input; the reason must not be shown verbatim
 * beyond a neutral bot reply.
 */
export async function redeemLinkCode(
  db: D1LikeDatabase,
  owner: string,
  code: string,
  tg: TelegramIdentity,
  botId: string,
  nowMs = Date.now(),
): Promise<RedeemResult> {
  await ensureTmaTables(db);
  if (!(await consumeRateLimit(TMA_LINK_RATE_LIMITS.redeemPerTgUser, `${owner}:${tg.id}`, nowMs)).allowed) {
    return { ok: false, reason: "rate_limited" };
  }
  const clean = code.startsWith(LINK_START_PREFIX) ? code.slice(LINK_START_PREFIX.length) : code;
  if (!CODE_RE.test(clean) || !Number.isSafeInteger(tg.id) || tg.id <= 0) return { ok: false, reason: "invalid" };
  const codeHash = await sha256Hex(clean);
  const claim = await db
    .prepare("UPDATE tma_link_codes SET used_at=? WHERE code_hash=? AND owner=? AND used_at IS NULL AND expires_at>?")
    .bind(nowMs, codeHash, owner, nowMs)
    .run();
  if (!claim.meta.changes) return { ok: false, reason: await classifyUnclaimed(db, owner, codeHash, nowMs) };
  const row = await db.prepare("SELECT user_id FROM tma_link_codes WHERE code_hash=?").bind(codeHash).first<{ user_id: string }>();
  const userId = String(row?.user_id || "");
  // The member may have left the workspace between minting and redeeming.
  if (!userId || (await resolveWorkspaceContext(userId)).ownerId !== owner) return { ok: false, reason: "invalid" };
  return { ok: true, userId, linkId: await bindLink(db, owner, userId, tg, botId) };
}

export async function findActiveLink(db: D1LikeDatabase, owner: string, tgUserId: number): Promise<TmaLink | null> {
  await ensureTmaTables(db);
  return rowLink(
    await db.prepare("SELECT * FROM tma_links WHERE owner=? AND tg_user_id=? AND revoked_at IS NULL").bind(owner, String(tgUserId)).first(),
  );
}

export async function findActiveLinkForUser(db: D1LikeDatabase, owner: string, userId: string): Promise<TmaLink | null> {
  await ensureTmaTables(db);
  return rowLink(
    await db.prepare("SELECT * FROM tma_links WHERE owner=? AND user_id=? AND revoked_at IS NULL").bind(owner, userId).first(),
  );
}

export async function findLinkById(db: D1LikeDatabase, id: string): Promise<TmaLink | null> {
  await ensureTmaTables(db);
  return rowLink(await db.prepare("SELECT * FROM tma_links WHERE id=?").bind(id).first());
}

/**
 * REQ-L3: a Login-Widget-verified Telegram account of a member of `owner` counts as linked; the link
 * row is created lazily. Skipped when the member unlinked before (a revoked row exists) or is already
 * linked to another Telegram account.
 */
async function linkFromLoginWidget(db: D1LikeDatabase, owner: string, tg: TelegramIdentity, botId: string): Promise<TmaLink | null> {
  await ensureUserTables();
  const oauth = await db
    .prepare("SELECT user_id FROM oauth_accounts WHERE provider='telegram' AND provider_user_id=?")
    .bind(String(tg.id))
    .first<{ user_id: string }>();
  const userId = oauth?.user_id ? String(oauth.user_id) : "";
  if (!userId) return null;
  const prior = await db.prepare("SELECT id FROM tma_links WHERE owner=? AND user_id=? LIMIT 1").bind(owner, userId).first();
  if (prior) return null;
  if ((await resolveWorkspaceContext(userId)).ownerId !== owner) return null;
  return findLinkById(db, await bindLink(db, owner, userId, tg, botId));
}

/** Active link of `tg` in `owner`, falling back to the Login-Widget account (REQ-L3). Membership is checked by the caller. */
export async function resolveTelegramLink(
  db: D1LikeDatabase,
  owner: string,
  tg: TelegramIdentity,
  botId: string,
): Promise<TmaLink | null> {
  return (await findActiveLink(db, owner, tg.id)) ?? linkFromLoginWidget(db, owner, tg, botId);
}

/** Revokes the member's active link (REQ-L4); returns it so the caller can reset the chat menu button. */
export async function revokeLink(db: D1LikeDatabase, owner: string, userId: string): Promise<TmaLink | null> {
  const link = await findActiveLinkForUser(db, owner, userId);
  if (!link) return null;
  await db.prepare("UPDATE tma_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(new Date().toISOString(), link.id).run();
  return link;
}

/** Opt in/out of private notices; enabling clears the last delivery error. False when not linked. */
export async function setDmNotices(db: D1LikeDatabase, owner: string, userId: string, enabled: boolean): Promise<boolean> {
  await ensureTmaTables(db);
  const r = await db
    .prepare(
      `UPDATE tma_links SET dm_notices=?, dm_error=CASE WHEN ?=1 THEN '' ELSE dm_error END
       WHERE owner=? AND user_id=? AND revoked_at IS NULL`,
    )
    .bind(enabled ? 1 : 0, enabled ? 1 : 0, owner, userId)
    .run();
  return r.meta.changes > 0;
}

/**
 * REQ-N2: a failed private notice records the (token-free) error and turns the opt-in off;
 * an empty `error` only clears the stored error.
 */
export async function setDmError(db: D1LikeDatabase, owner: string, tgUserId: number, error: string): Promise<void> {
  await ensureTmaTables(db);
  const text = error.slice(0, 300);
  await db
    .prepare(
      `UPDATE tma_links SET dm_error=?, dm_notices=CASE WHEN ?='' THEN dm_notices ELSE 0 END
       WHERE owner=? AND tg_user_id=? AND revoked_at IS NULL`,
    )
    .bind(text, text, owner, String(tgUserId))
    .run();
}

export type DmRecipient = { linkId: string; userId: string; tgUserId: number; canSeeLeads: boolean };

/**
 * Opted-in linked members who still belong to `owner` (owner itself or a workspace_members row),
 * with whether their web access covers leads/chats. One query, bounded.
 */
export async function listDmRecipients(db: D1LikeDatabase, owner: string): Promise<DmRecipient[]> {
  await ensureTmaTables(db);
  await ensureStaffTables();
  const rows = await db
    .prepare(
      `SELECT l.id, l.user_id, l.tg_user_id, m.role AS role, m.access AS access
       FROM tma_links l
       LEFT JOIN workspace_members m ON m.user_id=l.user_id AND m.workspace_owner_id=l.owner
       WHERE l.owner=? AND l.revoked_at IS NULL AND l.dm_notices=1
         AND (m.id IS NOT NULL OR (l.user_id=l.owner AND NOT EXISTS (SELECT 1 FROM workspace_members o WHERE o.user_id=l.owner)))
       LIMIT 200`,
    )
    .bind(owner)
    .all();
  return rows.results.map((r) => {
    const isOwner = r.role == null;
    const role = (STAFF_ROLES as readonly string[]).includes(String(r.role)) ? (r.role as StaffRole) : "viewer";
    let access = parseAccess({}, role);
    try {
      access = parseAccess(JSON.parse(String(r.access || "{}")), role);
    } catch {
      /* malformed access JSON → role preset */
    }
    return {
      linkId: String(r.id),
      userId: String(r.user_id),
      tgUserId: Number(r.tg_user_id),
      canSeeLeads: isOwner || role === "admin" || access.leads || access.chats,
    };
  });
}
