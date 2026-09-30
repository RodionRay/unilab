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
