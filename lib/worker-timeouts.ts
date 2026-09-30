/**
 * App-side view of the Telegram worker's limits. Mirrors
 * telegram-worker/src/worker-app.mjs (timeoutForAction("check_proxy") and the
 * default TG_WORKER_MAX_CONCURRENCY); tests/worker-proxy-timeout.test.ts pins
 * both so they cannot drift. Not imported directly: that module pulls
 * node:child_process into the app bundle.
 */
export const WORKER_CHECK_PROXY_TIMEOUT_MS = 18_000;
export const WORKER_DEFAULT_SLOTS = 4;
/** Network round trip and worker bookkeeping on top of the Python run. */
export const PROXY_CHECK_MARGIN_MS = 5_000;

/**
 * How long the app waits for one /check-proxy call when `batchSize` checks
 * are sent at once to a worker with `slots` Python slots: checks beyond the
 * slots queue in the worker, so the last one waits for every earlier round.
 */
export function proxyCheckTimeoutMs(batchSize: number, slots: number): number {
  const rounds = Math.ceil(Math.max(1, batchSize) / Math.max(1, slots));
  return rounds * WORKER_CHECK_PROXY_TIMEOUT_MS + PROXY_CHECK_MARGIN_MS;
}

/** Python slots of the worker, from the same env the worker reads. */
export function workerSlots(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : WORKER_DEFAULT_SLOTS;
}

/**
 * Worker job timeouts per action (worker-app.mjs timeoutForAction; pinned by
 * tests/tick-runtime.test.ts). The app must wait longer: the job may first sit in
 * the worker queue, and a slow-but-successful call must not look like a failure.
 */
export const WORKER_JOB_TIMEOUT_MS = {
  collect: 180_000,
  invite: 180_000,
  join: 120_000,
  send: 120_000,
} as const;
export type WorkerTickAction = keyof typeof WORKER_JOB_TIMEOUT_MS;
/** Queue wait + kill grace + network on top of the job timeout. */
export const WORKER_QUEUE_MARGIN_MS = 60_000;

export function workerAppTimeoutMs(action: WorkerTickAction): number {
  return WORKER_JOB_TIMEOUT_MS[action] + WORKER_QUEUE_MARGIN_MS;
}

export const WORKER_LONGEST_APP_TIMEOUT_MS =
  Math.max(...Object.values(WORKER_JOB_TIMEOUT_MS)) + WORKER_QUEUE_MARGIN_MS;
