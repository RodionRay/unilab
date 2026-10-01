import type { D1LikeDatabase } from "@/lib/db";
import { botIdFromToken } from "@/lib/tma/init-data";

/**
 * TMA tables (mirrors drizzle/0002_tma.sql; tests/tma-links.test.ts keeps them in sync) and the
 * per-workspace entry key `/tma/<wsKey>`. The key only selects which bot token verifies initData;
 * by itself it grants nothing.
 */
export const TMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tma_workspaces (
	ws_key text PRIMARY KEY NOT NULL,
	owner text NOT NULL,
	bot_id text DEFAULT '' NOT NULL,
	bot_username text DEFAULT '' NOT NULL,
	created text NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tma_workspaces_owner ON tma_workspaces (owner)`,
  `CREATE TABLE IF NOT EXISTS tma_links (
	id text PRIMARY KEY NOT NULL,
	owner text NOT NULL,
	user_id text NOT NULL,
	tg_user_id text NOT NULL,
	tg_username text DEFAULT '' NOT NULL,
	bot_id text DEFAULT '' NOT NULL,
	dm_notices integer DEFAULT 0 NOT NULL,
	dm_error text DEFAULT '' NOT NULL,
	created text NOT NULL,
	revoked_at text
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tma_links_active_tg ON tma_links (owner,tg_user_id) WHERE revoked_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tma_links_active_user ON tma_links (owner,user_id) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS tma_link_codes (
	code_hash text PRIMARY KEY NOT NULL,
	owner text NOT NULL,
	user_id text NOT NULL,
	expires_at integer NOT NULL,
	used_at integer,
	created text NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_tma_link_codes_expires ON tma_link_codes (expires_at)`,
];

const ensuredFor = new WeakSet<D1LikeDatabase>();

export async function ensureTmaTables(db: D1LikeDatabase): Promise<void> {
  if (ensuredFor.has(db)) return;
  for (const sql of TMA_DDL) await db.prepare(sql).bind().run();
  ensuredFor.add(db);
}

/** 24 random bytes, base64url (32 chars) — matches contract WS_KEY_RE. */
function randomKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

export type TmaWorkspace = { wsKey: string; owner: string; botId: string; botUsername: string };

function rowWorkspace(row: Record<string, unknown> | null): TmaWorkspace | null {
  if (!row) return null;
  return {
    wsKey: String(row.ws_key),
    owner: String(row.owner),
    botId: String(row.bot_id || ""),
    botUsername: String(row.bot_username || ""),
  };
}

/** The workspace's key, created on first use; concurrent callers converge on one row (UNIQUE owner). */
export async function getOrCreateWorkspaceKey(db: D1LikeDatabase, owner: string): Promise<string> {
  await ensureTmaTables(db);
  const select = () => db.prepare("SELECT * FROM tma_workspaces WHERE owner=?").bind(owner).first();
  const existing = rowWorkspace(await select());
  if (existing) return existing.wsKey;
  await db
    .prepare("INSERT OR IGNORE INTO tma_workspaces (ws_key,owner,bot_id,bot_username,created) VALUES (?,?,?,?,?)")
    .bind(randomKey(), owner, "", "", new Date().toISOString())
    .run();
  const created = rowWorkspace(await select());
  if (!created) throw new Error("tma workspace key was not stored");
  return created.wsKey;
}

export async function findWorkspaceByKey(db: D1LikeDatabase, wsKey: string): Promise<TmaWorkspace | null> {
  await ensureTmaTables(db);
  return rowWorkspace(await db.prepare("SELECT * FROM tma_workspaces WHERE ws_key=?").bind(wsKey).first());
}

export async function findWorkspaceByOwner(db: D1LikeDatabase, owner: string): Promise<TmaWorkspace | null> {
  await ensureTmaTables(db);
  return rowWorkspace(await db.prepare("SELECT * FROM tma_workspaces WHERE owner=?").bind(owner).first());
}

/** Caches the bot's @username (from getMe) so a not_linked answer can point to the bot without a network call. */
export async function rememberBotIdentity(db: D1LikeDatabase, owner: string, botId: string, botUsername: string): Promise<void> {
  await ensureTmaTables(db);
  await db
    .prepare("UPDATE tma_workspaces SET bot_id=?, bot_username=? WHERE owner=?")
    .bind(botId, botUsername, owner)
    .run();
}

export type WorkspaceBot = { token: string; botId: string; workspaceName: string };

/** Current bot token of the workspace (settings.notifyBotToken). Server-side only — never return it. */
export async function readWorkspaceBot(db: D1LikeDatabase, owner: string): Promise<WorkspaceBot> {
  const row = await db
    .prepare(
      `SELECT json_extract(data,'$.notifyBotToken') AS token, json_extract(data,'$.name') AS name,
        json_extract(data,'$.profileName') AS profile_name
       FROM records WHERE owner=? AND kind='settings' LIMIT 1`,
    )
    .bind(owner)
    .first<{ token: unknown; name: unknown; profile_name: unknown }>();
  const token = typeof row?.token === "string" ? row.token.trim() : "";
  const workspaceName = String(row?.name || row?.profile_name || "").slice(0, 200);
  return { token, botId: botIdFromToken(token), workspaceName };
}

/** `https://t.me/<bot>` when the cached username belongs to the current bot, else undefined. */
export function botLinkFor(ws: TmaWorkspace | null, currentBotId: string): string | undefined {
  if (!ws?.botUsername || !currentBotId || ws.botId !== currentBotId) return undefined;
  return `https://t.me/${ws.botUsername}`;
}
