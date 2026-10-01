/**
 * Auto-rescan queue order (docs/join-pipeline.md §Auto-rescan).
 *
 * A group's turn is measured from its last scan ATTEMPT, not only its last successful scan:
 * a scan that soft-fails (linked discussion not joined, membership still being confirmed) leaves
 * `lastScanned` empty, and ordering by `lastScanned` alone kept those groups at the head of the
 * queue forever — every tick spent its whole limit on them and no other group was ever scanned.
 */

function ts(iso: unknown): number {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? t : 0;
}

export type RescanGroup = { lastScanned?: unknown; scanTriedAt?: unknown };

/** Most recent scan or scan attempt; 0 = never touched (goes first). */
export function lastRescanTouch(group: RescanGroup): number {
  return Math.max(ts(group.lastScanned), ts(group.scanTriedAt));
}

/** Not yet due: touched within the rescan interval. `force` ignores the interval. */
export function rescanNotDue(group: RescanGroup, intervalMs: number, now: number, force = false): boolean {
  const last = lastRescanTouch(group);
  return !force && last > 0 && now - last < intervalMs;
}
