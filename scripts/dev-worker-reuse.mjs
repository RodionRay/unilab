/**
 * Whether `npm run dev` may reuse a Telegram worker that is already listening.
 * A worker from an earlier run holds that run's secrets; if any shared secret
 * was generated fresh for this run (e.g. CRON_SECRET), the old worker would
 * send the old value and get 401 from cron, so it is stale.
 *
 * @param {"ours" | "stale" | "foreign"} probe result of the /health probe
 * @param {readonly string[]} generatedSecrets secret names generated this run
 * @returns {"reuse" | "stale" | "foreign"}
 */
export function workerReuseVerdict(probe, generatedSecrets) {
  if (probe !== "ours") return probe;
  return generatedSecrets.length > 0 ? "stale" : "reuse";
}
