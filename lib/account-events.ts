import type { D1LikeDatabase } from "@/lib/db";

/**
 * Penalty journal per Telegram account (table `account_events`, migration drizzle/0002_account_events.sql).
 * The account record keeps only the current state (status, cooldownUntil, floodUntil, joinFloodUntil); this
 * journal keeps every penalty Telegram gave: PEER_FLOOD spamblock, FloodWait (+ seconds and where), @SpamBot
 * restriction, freeze, write ban, peer privacy / block errors.
 *
 * Writes are idempotent (`dedupe_key` unique per owner: account · type · context · subject · minute), reads are
 * bounded (one GROUP BY for all counters, list capped at ACCOUNT_EVENTS_LIST_MAX) and journal failures never
 * break the caller (`recordAccountEventSafe`).
 */

export const ACCOUNT_EVENT_TYPES = [
  "spamblock",
  "flood_wait",
  "spambot",
  "frozen",
  "write_ban",
  "privacy",
  "peer_blocked",
] as const;
export type AccountEventType = (typeof ACCOUNT_EVENT_TYPES)[number];

export const ACCOUNT_EVENT_CONTEXTS = ["join", "mailing", "invite", "dm", "check", "collect", "scan", "peer_check"] as const;
export type AccountEventContext = (typeof ACCOUNT_EVENT_CONTEXTS)[number];

export type AccountEventInput = {
  accountId: string;
  type: AccountEventType;
  context: AccountEventContext;
  waitSec?: number;
  reason?: string;
  /** what the event is about when one account gets many per minute (peer id for privacy errors) */
  subject?: string;
  at?: Date;
};

export type AccountEvent = {
  id: string;
  accountId: string;
  type: AccountEventType;
  context: AccountEventContext;
  waitSec: number | null;
  reason: string;
  at: string;
};

export type AccountEventCounts = { day: number; week: number; all: number; lastAt: string };

export const ACCOUNT_EVENTS_LIST_DEFAULT = 50;
export const ACCOUNT_EVENTS_LIST_MAX = 200;
const REASON_MAX = 300;
const DAY_MS = 24 * 3600_000;

const ready = new WeakSet<object>();

/** Same DDL as drizzle/0002_account_events.sql — instances that skipped the migration still work. */
export async function ensureAccountEventsTable(db: D1LikeDatabase): Promise<void> {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS account_events (
        id text PRIMARY KEY NOT NULL,
        owner text NOT NULL,
        account_id text NOT NULL,
        type text NOT NULL,
        context text NOT NULL,
        wait_sec integer,
        reason text NOT NULL DEFAULT '',
        at text NOT NULL,
        dedupe_key text NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_account_events_dedupe ON account_events (owner, dedupe_key)")
    .bind()
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_account_events_owner_account_at ON account_events (owner, account_id, at)")
    .bind()
    .run();
  ready.add(db);
}

export function accountEventDedupeKey(e: AccountEventInput, at: Date): string {
  const minute = Math.floor(at.getTime() / 60_000);
  return [e.accountId, e.type, e.context, e.subject || "", minute].join("|");
}

/** Inserts one event; false when the same event was already journaled this minute. */
export async function recordAccountEvent(db: D1LikeDatabase, owner: string, e: AccountEventInput): Promise<boolean> {
  if (!owner || !e.accountId) return false;
  if (!(ACCOUNT_EVENT_TYPES as readonly string[]).includes(e.type)) return false;
  if (!(ACCOUNT_EVENT_CONTEXTS as readonly string[]).includes(e.context)) return false;
  await ensureAccountEventsTable(db);
  const at = e.at ?? new Date();
  const wait = Number.isFinite(e.waitSec) && Number(e.waitSec) > 0 ? Math.round(Number(e.waitSec)) : null;
  const res = await db
    .prepare(
      `INSERT INTO account_events (id, owner, account_id, type, context, wait_sec, reason, at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner, dedupe_key) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      owner,
      e.accountId,
      e.type,
      e.context,
      wait,
      String(e.reason || "").slice(0, REASON_MAX),
      at.toISOString(),
      accountEventDedupeKey(e, at),
    )
    .run();
  return res.meta.changes > 0;
}

/** Journal must never break a send/join/tick: errors are logged and swallowed. */
export async function recordAccountEventSafe(db: D1LikeDatabase, owner: string, e: AccountEventInput | null): Promise<void> {
  if (!e) return;
  try {
    await recordAccountEvent(db, owner, e);
  } catch (err) {
    console.error("[account-events] record failed:", String((err as Error)?.message || err).slice(0, 200));
  }
}

type WorkerResultLike = {
  ok?: unknown;
  status?: unknown;
  join?: unknown;
  error?: unknown;
  errorCode?: unknown;
  waitSec?: unknown;
  floodWait?: unknown;
};

const WRITE_BAN_RE = /нельзя писать в чаты|banned from sending|chat_write_forbidden|user_banned_in_channel|бан на запись/i;
const FLOOD_TEXT_RE = /FloodWait\s*(\d+)?/i;

/**
 * Penalty described by a raw worker answer, or null. Statuses come from telegram-worker check_account.py:
 * flood/floodwait (+waitSec|floodWait), spamblock (PEER_FLOOD or write ban), frozen, join=peer_flood, and peer
 * error codes. In the `check` context a spamblock comes from @SpamBot.
 */
export function accountEventFromWorkerResult(
  result: WorkerResultLike | null | undefined,
  context: AccountEventContext,
): Omit<AccountEventInput, "accountId"> | null {
  if (!result || result.ok === true) return null;
  const status = String(result.status || "");
  const join = String(result.join || "");
  const error = String(result.error || "");
  const code = String(result.errorCode || "").toUpperCase();
  if (status === "flood" || status === "floodwait" || join === "flood" || /^FloodWait/i.test(error)) {
    const m = FLOOD_TEXT_RE.exec(error);
    const waitSec = Number(result.waitSec) || Number(result.floodWait) || (m?.[1] ? Number(m[1]) : 0) || undefined;
    return { type: "flood_wait", context, waitSec, reason: error || "FloodWait" };
  }
  if (status === "frozen" || join === "frozen") return { type: "frozen", context, reason: error || "Аккаунт заморожен Telegram" };
  if (status === "spamblock" || join === "peer_flood" || /PEER_FLOOD/i.test(error)) {
    if (context === "check") return { type: "spambot", context, reason: error || "@SpamBot: аккаунт ограничен" };
    if (WRITE_BAN_RE.test(error)) return { type: "write_ban", context, reason: error };
    return { type: "spamblock", context, reason: error || "PEER_FLOOD" };
  }
  if (code === "USER_IS_BLOCKED") return { type: "peer_blocked", context, reason: error || code };
  if (code === "USER_PRIVACY_RESTRICTED" || code === "PRIVACY_PREMIUM_REQUIRED") {
    return { type: "privacy", context, reason: error || code };
  }
  return null;
}

/** Journal entry for a worker answer about `accountId` (null when it is not a penalty). */
export function accountEventFor(
  accountId: string,
  result: WorkerResultLike | null | undefined,
  context: AccountEventContext,
  subject = "",
): AccountEventInput | null {
  const e = accountEventFromWorkerResult(result, context);
  return e && accountId ? { ...e, accountId, subject } : null;
}

/** Counters for every account of the owner in one query (no N+1). */
export async function accountEventCounts(
  db: D1LikeDatabase,
  owner: string,
  now = new Date(),
): Promise<Record<string, AccountEventCounts>> {
  await ensureAccountEventsTable(db);
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const rows = await db
    .prepare(
      `SELECT account_id AS accountId,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS day,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS week,
              COUNT(*) AS allCount,
              MAX(at) AS lastAt
         FROM account_events WHERE owner = ? GROUP BY account_id`,
    )
    .bind(dayAgo, weekAgo, owner)
    .all();
  const out: Record<string, AccountEventCounts> = {};
  for (const r of rows.results) {
    out[String(r.accountId)] = {
      day: Number(r.day) || 0,
      week: Number(r.week) || 0,
      all: Number(r.allCount) || 0,
      lastAt: String(r.lastAt || ""),
    };
  }
  return out;
}

/** Newest first, capped. */
export async function listAccountEvents(
  db: D1LikeDatabase,
  owner: string,
  accountId: string,
  limit = ACCOUNT_EVENTS_LIST_DEFAULT,
): Promise<AccountEvent[]> {
  await ensureAccountEventsTable(db);
  const cap = Math.max(1, Math.min(ACCOUNT_EVENTS_LIST_MAX, Math.floor(Number(limit) || ACCOUNT_EVENTS_LIST_DEFAULT)));
  const rows = await db
    .prepare(
      `SELECT id, account_id AS accountId, type, context, wait_sec AS waitSec, reason, at
         FROM account_events WHERE owner = ? AND account_id = ? ORDER BY at DESC LIMIT ?`,
    )
    .bind(owner, accountId, cap)
    .all();
  return rows.results.map((r) => ({
    id: String(r.id),
    accountId: String(r.accountId),
    type: String(r.type) as AccountEventType,
    context: String(r.context) as AccountEventContext,
    waitSec: r.waitSec == null ? null : Number(r.waitSec),
    reason: String(r.reason || ""),
    at: String(r.at),
  }));
}
