/**
 * Server-side task runner (REQ-I4): finds due invite / mailing / audience tasks of every
 * owner and ticks them within a time budget, so tasks keep going with the browser closed.
 * Driven by POST /api/cron/tasks-tick (telegram-worker server.mjs loop).
 */
import type { D1LikeDatabase } from "@/lib/db";
import type { TickTaskKind } from "@/lib/processes/tick-lock";

export type DueTask = Readonly<{ owner: string; id: string; kind: TickTaskKind }>;

export const TICK_ACTIONS: Readonly<Record<TickTaskKind, string>> = {
  invite_task: "tick_invite",
  mailing_task: "tick_mailing",
  audience_task: "tick_audience",
};

/** Upper bound of tasks looked at per run; the rest waits for the next run. */
export const DUE_TASKS_LIMIT = 200;

type DueRow = { owner: string; id: string; kind: string; nextAt: unknown; lockUntil: unknown };

function isoMs(v: unknown): number {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : 0;
}

/**
 * `running` / `scheduled` tasks whose nextAt passed (or is empty) and whose tick lock is not
 * live, oldest nextAt first. Only three JSON fields are read — no full task payloads.
 */
export async function listDueTasks(
  db: D1LikeDatabase,
  now = Date.now(),
  limit = DUE_TASKS_LIMIT,
): Promise<DueTask[]> {
  const rows = await db
    .prepare(
      "SELECT owner,id,kind,json_extract(data,'$.nextAt') AS nextAt,json_extract(data,'$.tickLockUntil') AS lockUntil " +
        "FROM records WHERE kind IN ('invite_task','mailing_task','audience_task') " +
        "AND json_extract(data,'$.status') IN ('running','scheduled')",
    )
    .bind()
    .all();
  return (rows.results as DueRow[])
    .filter((r) => isoMs(r.nextAt) <= now && isoMs(r.lockUntil) <= now)
    .sort((a, b) => isoMs(a.nextAt) - isoMs(b.nextAt))
    .slice(0, limit)
    .map((r) => ({ owner: String(r.owner), id: String(r.id), kind: r.kind as TickTaskKind }));
}

export type TickOutcome = Readonly<{ task: DueTask; ok: boolean; note: string }>;

export type RunDueTicksOptions = {
  tasks: readonly DueTask[];
  tick: (task: DueTask, timeoutMs: number) => Promise<TickOutcome>;
  /** Wall-clock budget of the whole run. */
  budgetMs: number;
  /** Cap of one tick call; a longer tick keeps running server-side under its lock. */
  callTimeoutMs: number;
  /** Do not start a tick with less budget left than this. */
  minStartMs: number;
  concurrency: number;
  now?: () => number;
};

/** Ticks tasks with a small worker pool; `more` = some due tasks were not started. */
export async function runDueTicks(
  opts: RunDueTicksOptions,
): Promise<{ outcomes: TickOutcome[]; more: boolean }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const left = () => opts.budgetMs - (now() - started);
  const queue = [...opts.tasks];
  const outcomes: TickOutcome[] = [];
  const lane = async () => {
    for (;;) {
      if (left() < opts.minStartMs) return;
      const task = queue.shift();
      if (!task) return;
      outcomes.push(await opts.tick(task, Math.min(opts.callTimeoutMs, left())));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, lane));
  return { outcomes, more: queue.length > 0 };
}
