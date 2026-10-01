import type { D1LikeDatabase } from "@/lib/db";

export type RecordData = Record<string, unknown>;

const CAS_ATTEMPTS = 8;

/** Other writers kept changing the row through every CAS attempt; nothing of ours was written. */
export class RecordConflictError extends Error {
  constructor(kind: string) {
    super(`Запись ${kind} меняется слишком часто — не сохранена`);
    this.name = "RecordConflictError";
  }
}

function parseData(raw: string): RecordData | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RecordData) : null;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write of any record guarded by compare-and-swap on the whole JSON: a writer that
 * built its value from an older read never drops fields another writer committed in between.
 * `mutate` gets the row as it is now (null = stored JSON is broken). `secret` (when given) is
 * written in the same statement. Returns the stored value, or null when the row is gone;
 * throws RecordConflictError when every attempt lost the race.
 */
export async function updateRecordData(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  kind: string,
  mutate: (fresh: RecordData | null) => RecordData,
  opts: { secret?: string | null } = {},
): Promise<RecordData | null> {
  const withSecret = opts.secret !== undefined;
  const sql = `UPDATE records SET data=?${withSecret ? ",secret=?" : ""} WHERE owner=? AND id=? AND kind=? AND data=?`;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await db
      .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind=?")
      .bind(owner, id, kind)
      .first<{ data: string }>();
    if (!row) return null;
    const next = mutate(parseData(row.data));
    const values = withSecret
      ? [JSON.stringify(next), opts.secret, owner, id, kind, row.data]
      : [JSON.stringify(next), owner, id, kind, row.data];
    const res = await db.prepare(sql).bind(...values).run();
    if (res.meta.changes === 1) return next;
  }
  throw new RecordConflictError(kind);
}
