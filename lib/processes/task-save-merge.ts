/**
 * Editing a task from the form (REQ-I5): the client owns only config fields.
 * Status, lock, schedule, log and every progress counter stay as the server has them,
 * so a stale form can neither rewind progress nor clear a live tick lock.
 */
import { TICK_PROGRESS_KEYS, type TaskData, type TickTaskKind } from "@/lib/processes/tick-lock";

const SERVER_OWNED_COMMON = [
  "status",
  "error",
  "nextAt",
  "tickLockUntil",
  "tickLockId",
  "log",
  "lastTickAt",
  "total",
] as const;

const SERVER_OWNED_EXTRA: Readonly<Record<TickTaskKind, readonly string[]>> = {
  invite_task: ["cursorUserId"],
  mailing_task: ["cursor"],
  audience_task: [],
};

/** Progress that belongs to one audience source; stale once the source changes. */
const AUDIENCE_SOURCE_RESET: TaskData = {
  cursor: "",
  collected: 0,
  total: 0,
  hasMore: true,
  emptyStreak: 0,
  title: "",
  sourceChannelId: "",
  sourceAccessHash: "",
  sourceAccountId: "",
};

export function serverOwnedTaskKeys(kind: TickTaskKind): ReadonlySet<string> {
  return new Set([...SERVER_OWNED_COMMON, ...TICK_PROGRESS_KEYS[kind], ...SERVER_OWNED_EXTRA[kind]]);
}

/** `submitted` = validated form data; `prev` = the stored row (may hold keys the schema drops). */
export function mergeTaskSave(kind: TickTaskKind, prev: TaskData, submitted: TaskData): TaskData {
  const owned = serverOwnedTaskKeys(kind);
  const config = Object.fromEntries(Object.entries(submitted).filter(([key]) => !owned.has(key)));
  const next: TaskData = { ...prev, ...config };
  if (kind !== "audience_task") return next;
  const sourceChanged =
    String(prev.url || "") !== String(next.url || "") ||
    String(prev.collectMode || "discussions") !== String(next.collectMode || "discussions");
  return sourceChanged ? { ...next, ...AUDIENCE_SOURCE_RESET } : next;
}
