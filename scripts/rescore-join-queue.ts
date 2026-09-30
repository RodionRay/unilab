/**
 * One-off re-score of the join queue straight in a local D1/SQLite file (stand / self-hosted).
 * The running app does the same through the `rescore_join_queue` workspace action.
 *
 *   npx tsx scripts/rescore-join-queue.ts --db <file.sqlite> [--owner <id>] [--apply] [--backup <file.json>] [--top 10]
 *
 * Dry-run by default: prints band counts and the top/bottom groups. `--apply` first writes every group
 * row it will touch to the backup JSON (default: OS temp dir, never the repo), then updates only those
 * group rows (settings are never written).
 */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRelevanceProfile, joinGateFor, rescoreGroup, seedRejoin } from "@/lib/join-relevance";
import { seedMissingAccounts } from "@/lib/processes/join-flow";

type Row = { id: string; owner: string; data: string };

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? String(process.argv[i + 1] || "") : "";
}

function main() {
  const file = arg("db");
  if (!file) throw new Error("--db <file.sqlite> is required");
  const apply = process.argv.includes("--apply");
  const top = Math.max(1, Number(arg("top")) || 10);
  const db = new Database(file, { readonly: !apply });
  const ownerFilter = arg("owner");
  const settingsRows = db
    .prepare("SELECT owner, data FROM records WHERE kind='settings'" + (ownerFilter ? " AND owner=?" : ""))
    .all(...(ownerFilter ? [ownerFilter] : [])) as { owner: string; data: string }[];
  if (!settingsRows.length) throw new Error("no settings rows");

  const backup: Row[] = [];
  const updates: { id: string; owner: string; data: string; prev: string }[] = [];
  const report: Record<string, unknown>[] = [];
  const now = new Date();
  for (const s of settingsRows) {
    const profile = buildRelevanceProfile(JSON.parse(s.data));
    const groups = db.prepare("SELECT id, owner, data FROM records WHERE kind='group' AND owner=?").all(s.owner) as Row[];
    const counts: Record<string, number> = {};
    const scored: { name: string; score: number; state: string; reason: string }[] = [];
    let cleared = 0;
    let seeded = 0;
    let rejoined = 0;
    for (const row of groups) {
      const g = JSON.parse(row.data);
      let next = seedRejoin(g);
      if (next !== g) rejoined++;
      const patch = rescoreGroup(next, profile, { force: true, now });
      if (patch) {
        next = { ...next, joinRelevance: patch.joinRelevance };
        if (patch.clearQueue) {
          next = { ...next, joinState: "", joinStateAt: "" };
          cleared++;
        }
      }
      const withSeed = seedMissingAccounts(next);
      if (withSeed !== next) seeded++;
      next = withSeed;
      const gate = joinGateFor(next);
      counts[gate.state] = (counts[gate.state] || 0) + 1;
      if (gate.state !== "joined") {
        scored.push({ name: String(g.name || ""), score: gate.score ?? -1, state: gate.state, reason: gate.reason });
      }
      if (next !== g) {
        backup.push(row);
        updates.push({ id: row.id, owner: row.owner, data: JSON.stringify(next), prev: row.data });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    report.push({
      owner: s.owner,
      groups: groups.length,
      counts,
      queueCleared: cleared,
      missingSeeded: seeded,
      rejoinSeeded: rejoined,
      top: scored.slice(0, top),
      bottom: scored.slice(-top),
    });
  }
  console.log(JSON.stringify({ apply, changed: updates.length, report }, null, 2));
  if (!apply) return;
  // Backups hold real group data: never default into the (public) repo checkout.
  const backupFile = arg("backup") || join(tmpdir(), `join-rescore-backup-${Date.now()}.json`);
  writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  // CAS on the row read above: a live app may write the same group meanwhile — skip, never clobber.
  const stmt = db.prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='group' AND data=?");
  let applied = 0;
  const tx = db.transaction(() => {
    for (const u of updates) applied += stmt.run(u.data, u.id, u.owner, u.prev).changes;
  });
  tx();
  console.log(`applied ${applied}/${updates.length} group rows (rest changed concurrently) · backup ${backupFile}`);
}

main();
