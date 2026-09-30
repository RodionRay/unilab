/**
 * Transient tick failures (REQ-I2): the worker is full (429) or our own abort timeout
 * fired. Neither says anything about the task, so the tick is retried in 30–60 s
 * instead of putting the task into `error`.
 */

/** Worker answered 429: every slot and queue place is taken; nothing is wrong with the target. */
export class WorkerBusyError extends Error {
  override name = "WorkerBusyError";
}

/** Our tick lock was taken over (expired mid-call); the other tick owns the task now. */
export class TickLockLostError extends Error {
  override name = "TickLockLostError";
}

export const TICK_RETRY_MIN_SEC = 30;
export const TICK_RETRY_MAX_SEC = 60;

export function isAbortTimeout(e: unknown): boolean {
  const name = String((e as Error | null)?.name || "");
  return name === "TimeoutError" || name === "AbortError";
}

export function isRetryableTickError(e: unknown): boolean {
  return e instanceof WorkerBusyError || e instanceof TickLockLostError || isAbortTimeout(e);
}

export function tickRetryDelaySec(random: () => number = Math.random): number {
  const span = TICK_RETRY_MAX_SEC - TICK_RETRY_MIN_SEC;
  return TICK_RETRY_MIN_SEC + Math.floor(random() * (span + 1));
}

/** Patch + log line for a retryable failure: stays `running`, next try in 30–60 s. */
export function tickRetryPatch(
  e: unknown,
  now = Date.now(),
  random: () => number = Math.random,
): { patch: { status: "running"; error: ""; nextAt: string }; waitSec: number; text: string } {
  const waitSec = tickRetryDelaySec(random);
  const why =
    e instanceof WorkerBusyError
      ? "Telegram-воркер занят"
      : e instanceof TickLockLostError
        ? "Тик перехвачен другим запуском"
        : "Таймаут ответа Telegram-воркера";
  return {
    patch: { status: "running", error: "", nextAt: new Date(now + waitSec * 1000).toISOString() },
    waitSec,
    text: `${why} — повтор через ${waitSec} с`,
  };
}
