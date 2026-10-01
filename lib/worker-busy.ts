/**
 * The Telegram worker answered 429: every slot and queue place is taken. Says nothing
 * about the proxy, account or group the call was about, so callers keep their state.
 */
export class WorkerBusyError extends Error {
  override name = "WorkerBusyError";
}
