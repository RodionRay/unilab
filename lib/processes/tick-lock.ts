/**
 * Shared tick runtime for invite / mailing / audience tasks: an atomic per-task lock
 * and a commit that merges the tick result into the row as it is *now*.
 *
 * Lock = `tickLockUntil` (ISO, UTC) + `tickLockId` (owner token) inside the record JSON.
 * It is taken by one conditional UPDATE (only when empty/expired), so two concurrent
 * ticks of one task never both run. The TTL covers the whole worst-case tick (wall budget,
 * lib/processes/tick-budget.ts) and is renewed before every worker call (`renewTickLock`).
 */
import type { D1LikeDatabase } from "@/lib/db";
import type { TaskLogEntry } from "@/lib/audience-invite";
import { TickLockLostError } from "@/lib/processes/tick-retry";
import { TICK_WORST_CASE_MS, startTickBudget, type TickBudget } from "@/lib/processes/tick-budget";

export type TickTaskKind = "audience_task" | "invite_task" | "mailing_task";
export type TaskData = Record<string, unknown>;
export type TickLogInput = { level: TaskLogEntry["level"]; text: string; at?: string };

export type TickLock = Readonly<{
  owner: string;
  id: string;
  kind: TickTaskKind;
  token: string;
}>;

/** A whole tick fits even without a renewal; renewals keep it live past a slow commit. */
export const TICK_LOCK_TTL_MS = TICK_WORST_CASE_MS;

const LOCK_KEYS = ["tickLockUntil", "tickLockId"] as const;
const CAS_ATTEMPTS = 8;

/** Fields a tick owns; kept even when the user paused the task mid-tick (REQ-I3). */
export const TICK_PROGRESS_KEYS: Readonly<Record<TickTaskKind, readonly string[]>> = {
  invite_task: ["done", "invitedToday", "inviteDay", "alreadyMembers", "skipped", "accountIndex", "lastTickAt"],
  mailing_task: [
    "sentTotal",
    "sentToday",
    "sendDay",
    "failed",
    "deliveredKeys",
    "deferredUntil",
    "peerMisses",
    "deliveries",
    "aiPool",
    "aiPoolUsed",
    "accountIndex",
    "lastAccountId",
    "lastTickAt",
  ],
  audience_task: [
    "collected",
    "total",
    "cursor",
    "hasMore",
    "emptyStreak",
    "accountRotateAt",
    "title",
    "lastTickAt",
    "sourceChannelId",
    "sourceAccessHash",
    "sourceAccountId",
    "scannedMessages",
    "warning",
  ],
};

export const TICK_LOG_CAP: Readonly<Record<TickTaskKind, number>> = {
  invite_task: 200,
  mailing_task: 500,
  audience_task: 200,
};

export function tickLockIsLive(data: TaskData | null | undefined, now = Date.now()): boolean {
  const until = Date.parse(String(data?.tickLockUntil || ""));
  return Number.isFinite(until) && until > now;
}

/** Seconds until a live lock expires (for `busy` replies). */
export function tickLockWaitSec(data: TaskData | null | undefined, now = Date.now()): number {
  const until = Date.parse(String(data?.tickLockUntil || ""));
  return Number.isFinite(until) ? Math.max(1, Math.ceil((until - now) / 1000)) : 1;
}

function parseData(raw: unknown): TaskData | null {
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as TaskData) : null;
  } catch {
    return null;
  }
}

export async function readTask(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: TickTaskKind,
): Promise<TaskData | null> {
  const row = await db
    .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind=?")
    .bind(owner, id, kind)
    .first<{ data: string }>();
  return row ? parseData(row.data) : null;
}

/**
 * Takes the lock with one conditional UPDATE; null when another tick holds a live lock
 * (or the row is gone). ISO strings compare lexicographically, so `<= now` = expired.
 */
export async function acquireTickLock(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: TickTaskKind,
  opts: { now?: number; ttlMs?: number; token?: string } = {},
): Promise<TickLock | null> {
  const now = opts.now ?? Date.now();
  const token = opts.token ?? crypto.randomUUID();
  const until = new Date(now + (opts.ttlMs ?? TICK_LOCK_TTL_MS)).toISOString();
  const res = await db
    .prepare(
      "UPDATE records SET data=json_set(data,'$.tickLockUntil',?,'$.tickLockId',?) " +
        "WHERE owner=? AND id=? AND kind=? AND COALESCE(json_extract(data,'$.tickLockUntil'),'')<=?",
    )
    .bind(until, token, owner, id, kind, new Date(now).toISOString())
    .run();
  return res.meta.changes === 1 ? { owner, id, kind, token } : null;
}

/** Extends our lock before a worker call; false when the lock is no longer ours. */
export async function renewTickLock(
  db: D1LikeDatabase,
  lock: TickLock,
  opts: { now?: number; ttlMs?: number } = {},
): Promise<boolean> {
  const until = new Date((opts.now ?? Date.now()) + (opts.ttlMs ?? TICK_LOCK_TTL_MS)).toISOString();
  const res = await db
    .prepare(
      "UPDATE records SET data=json_set(data,'$.tickLockUntil',?) " +
        "WHERE owner=? AND id=? AND kind=? AND json_extract(data,'$.tickLockId')=?",
    )
    .bind(until, lock.owner, lock.id, lock.kind, lock.token)
    .run();
  return res.meta.changes === 1;
}

/**
 * Read-modify-write guarded by compare-and-swap on the whole JSON, so a concurrent
 * pause/start/save between our read and write is never overwritten. Returns the
 * stored value, or null when the row is gone.
 */
export async function updateTaskData(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: TickTaskKind,
  mutate: (fresh: TaskData) => TaskData,
): Promise<TaskData | null> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await db
      .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind=?")
      .bind(owner, id, kind)
      .first<{ data: string }>();
    if (!row) return null;
    const fresh = parseData(row.data) ?? {};
    const next = mutate(fresh);
    const res = await db
      .prepare("UPDATE records SET data=? WHERE owner=? AND id=? AND kind=? AND data=?")
      .bind(JSON.stringify(next), owner, id, kind, row.data)
      .run();
    if (res.meta.changes === 1) return next;
  }
  throw new Error(`Задача ${kind} меняется слишком часто — запись не сохранена`);
}

export type TickCommit = {
  /** Fields the tick wants to set (status, counters, nextAt …). Lock keys are ignored. */
  patch: TaskData;
  /** Log lines to append to the log as it is now. */
  entries?: readonly TickLogInput[];
};

function appendLog(log: unknown, entries: readonly TickLogInput[], cap: number): TaskLogEntry[] {
  const base = Array.isArray(log) ? (log as TaskLogEntry[]) : [];
  const at = new Date().toISOString();
  const added = entries.map((e) => ({ at: e.at || at, level: e.level, text: e.text.slice(0, 400) }));
  return [...base, ...added].slice(-cap);
}

/**
 * Pure merge of a tick result into the fresh row. Paused by the user (or the lock is no
 * longer ours) → only progress fields and log lines land; status/nextAt/error stay.
 * Our lock is released; someone else's live lock is left alone.
 */
export function mergeTickResult(
  fresh: TaskData,
  kind: TickTaskKind,
  token: string,
  commit: TickCommit,
): TaskData {
  const ours = fresh.tickLockId === token;
  const stopped = fresh.status === "paused" || !ours;
  const progress = new Set(TICK_PROGRESS_KEYS[kind]);
  const applied: TaskData = {};
  for (const [key, value] of Object.entries(commit.patch)) {
    if (key === "log" || (LOCK_KEYS as readonly string[]).includes(key)) continue;
    if (stopped && !progress.has(key)) continue;
    applied[key] = value;
  }
  const next: TaskData = { ...fresh, ...applied };
  if (commit.entries?.length) next.log = appendLog(fresh.log, commit.entries, TICK_LOG_CAP[kind]);
  if (ours) {
    next.tickLockUntil = "";
    next.tickLockId = "";
  }
  return next;
}

/** Writes the tick result (merged into the current row) and releases the lock. */
export async function commitTick(
  db: D1LikeDatabase,
  lock: TickLock,
  commit: TickCommit,
): Promise<TaskData | null> {
  return updateTaskData(db, lock.owner, lock.id, lock.kind, (fresh) =>
    mergeTickResult(fresh, lock.kind, lock.token, commit),
  );
}

export type TickSession = Readonly<{
  lock: TickLock;
  /** The row right after the lock was taken; the tick builds its `next` objects from it. */
  base: TaskData;
  /** Wall budget from the lock; a worker call starts only when it fits (tick-budget.ts). */
  budget: TickBudget;
  /** Throws TickLockLostError when the lock is no longer ours. Call before every worker call. */
  renew: () => Promise<void>;
  /** Commits what changed between `base` and `next` (+ extra log lines) and releases the lock. */
  finish: (next: TaskData, extra?: readonly TickLogInput[]) => Promise<TaskData>;
}>;

export type TickStart =
  | { state: "locked"; session: TickSession }
  | { state: "busy"; data: TaskData }
  | { state: "gone" };

/** Takes the lock and opens a session, or reports who holds it. */
export async function startTickSession(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: TickTaskKind,
): Promise<TickStart> {
  const lock = await acquireTickLock(db, owner, id, kind);
  if (!lock) {
    const data = await readTask(db, owner, id, kind);
    return data ? { state: "busy", data } : { state: "gone" };
  }
  const base = await readTask(db, owner, id, kind);
  if (!base) return { state: "gone" };
  const session: TickSession = {
    lock,
    base,
    budget: startTickBudget(),
    renew: async () => {
      if (!(await renewTickLock(db, lock))) throw new TickLockLostError("Блокировка тика потеряна");
    },
    finish: async (next, extra = []) => {
      const commit = tickCommitFromSnapshot(base, next);
      const stored = await commitTick(db, lock, {
        patch: commit.patch,
        entries: [...(commit.entries ?? []), ...extra],
      });
      return stored ?? next;
    },
  };
  return { state: "locked", session };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * For code that builds a whole `next` object from its tick-start snapshot: the patch is
 * only what the tick changed, the entries are only the log lines it appended.
 */
export function tickCommitFromSnapshot(base: TaskData, next: TaskData): TickCommit {
  const patch: TaskData = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "log") continue;
    if (!sameJson(base[key], value)) patch[key] = value;
  }
  const baseLog = Array.isArray(base.log) ? (base.log as TaskLogEntry[]) : [];
  const nextLog = Array.isArray(next.log) ? (next.log as TaskLogEntry[]) : [];
  let from = 0;
  if (baseLog.length) {
    const last = JSON.stringify(baseLog[baseLog.length - 1]);
    const idx = nextLog.map((e) => JSON.stringify(e)).lastIndexOf(last);
    from = idx >= 0 ? idx + 1 : sameJson(baseLog, nextLog) ? nextLog.length : 0;
  }
  return { patch, entries: nextLog.slice(from) };
}

/**
 * A user action (pause / start / refill) built as a whole `next` from its `base` read, replayed
 * onto the row as it is now: only the keys it changed and the log lines it appended, so tick
 * progress committed in between survives. A live tick lock is kept, an expired one cleared.
 */
export function rebaseTaskEdit(
  fresh: TaskData,
  base: TaskData,
  next: TaskData,
  kind: TickTaskKind,
  now = Date.now(),
): TaskData {
  const commit = tickCommitFromSnapshot(base, next);
  const out: TaskData = { ...fresh };
  for (const [key, value] of Object.entries(commit.patch)) {
    if (!(LOCK_KEYS as readonly string[]).includes(key)) out[key] = value;
  }
  if (commit.entries?.length) out.log = appendLog(fresh.log, commit.entries, TICK_LOG_CAP[kind]);
  if (!tickLockIsLive(fresh, now)) {
    out.tickLockUntil = "";
    out.tickLockId = "";
  }
  return out;
}

/** CAS write of a user action; returns the stored row (null when the task is gone). */
export function commitTaskEdit(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: TickTaskKind,
  base: TaskData,
  next: TaskData,
): Promise<TaskData | null> {
  return updateTaskData(db, owner, id, kind, (fresh) => rebaseTaskEdit(fresh, base, next, kind));
}
