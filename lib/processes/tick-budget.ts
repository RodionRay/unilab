/**
 * Wall-clock budget of one invite / mailing / audience tick.
 *
 * The app runs on workerd, which cancels a handler as soon as its client (the cron runner's
 * self-fetch, a browser tab) disconnects: a cancelled tick never reaches `session.finish`, so
 * its lock stays until TTL and its progress (sent keys, deliveries, invites) is lost. A tick
 * therefore starts a worker call only when the call's own timeout still fits into the budget;
 * otherwise it commits what it has and continues on the next tick. Worst-case tick =
 * TICK_WALL_BUDGET_MS + TICK_FINISH_MARGIN_MS, and every caller waits at least that long
 * (tasks-tick-runner TASKS_TICK_CALL_TIMEOUT_MS; tests/tick-budget.test.ts pins the chain).
 */
import { WORKER_LONGEST_APP_TIMEOUT_MS } from "@/lib/worker-timeouts";
import { TickBudgetExhaustedError } from "@/lib/processes/tick-retry";

/** The longest single worker call plus a minute of DB work before it. */
export const TICK_WALL_BUDGET_MS = WORKER_LONGEST_APP_TIMEOUT_MS + 60_000;
/** DB work after the last worker call (account updates, registry, commit). */
export const TICK_FINISH_MARGIN_MS = 30_000;
/** Longest a tick can run from lock to commit. */
export const TICK_WORST_CASE_MS = TICK_WALL_BUDGET_MS + TICK_FINISH_MARGIN_MS;

export type TickBudget = Readonly<{
  /** True when a call with this timeout would still end inside the budget. */
  fits: (callTimeoutMs: number) => boolean;
  /** Throws TickBudgetExhaustedError when the call does not fit. */
  assertFits: (callTimeoutMs: number) => void;
}>;

export function startTickBudget(
  wallMs = TICK_WALL_BUDGET_MS,
  now: () => number = () => Date.now(),
): TickBudget {
  const started = now();
  const fits = (callTimeoutMs: number) => now() - started + callTimeoutMs <= wallMs;
  return {
    fits,
    assertFits: (callTimeoutMs) => {
      if (!fits(callTimeoutMs)) throw new TickBudgetExhaustedError("Лимит времени тика исчерпан");
    },
  };
}
