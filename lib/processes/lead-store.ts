/**
 * D1 access of the lead core (docs/leads-pipeline.md): owner-scoped project rows, compare-and-set
 * updates of leads/projects and the per-owner daily AI caps. Every query is bound to `owner`.
 */

import type { D1LikeDatabase } from "@/lib/db";
import type { LeadData } from "@/lib/lead-conversation";
import {
  dayKey,
  defaultProjectId,
  ensureDefaultProject,
  parseProjectData,
  type ProjectData,
  type ProjectRow,
} from "@/lib/leads";

const CAS_ATTEMPTS = 5;

export const DEFAULT_JUDGE_DAILY_CAP = 3000;
export const DEFAULT_DRAFT_DAILY_CAP = 200;
export type DailyCapKind = "judge-day" | "draft-day";

/** Lead/project rows change under us (DM poll, scans, saves): writes are compare-and-set on the row text. */
export class RecordUpdateConflictError extends Error {}

export type SettingsRow = { id: string | null; data: Record<string, unknown>; secret: string | null };

function parseObject(raw: unknown): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(String(raw));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function loadSettingsRow(db: D1LikeDatabase, owner: string): Promise<SettingsRow> {
  const row = await db
    .prepare("SELECT id,data,secret FROM records WHERE owner=? AND kind='settings' LIMIT 1")
    .bind(owner)
    .first<{ id: string; data: string; secret: string | null }>();
  if (!row) return { id: null, data: {}, secret: null };
  return { id: String(row.id), data: parseObject(row.data), secret: row.secret ?? null };
}

/**
 * The owner's project `id`, or null when it is not theirs. The default project id is always the
 * owner's: its row is created lazily from `settings` (REQ-2).
 */
export async function findOwnedProject(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  settings: Record<string, unknown>,
  nowMs: number,
): Promise<ProjectRow | null> {
  if (id === defaultProjectId(owner)) return ensureDefaultProject(db, owner, settings, nowMs);
  const row = await db
    .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind='project'")
    .bind(owner, id)
    .first<{ data: string }>();
  return row ? { id, project: parseProjectData(row.data) } : null;
}

/** All projects of the owner, the default one first (created lazily). */
export async function listProjects(
  db: D1LikeDatabase,
  owner: string,
  settings: Record<string, unknown>,
  nowMs: number,
): Promise<ProjectRow[]> {
  const fallback = await ensureDefaultProject(db, owner, settings, nowMs);
  const res = await db
    .prepare("SELECT id,data FROM records WHERE owner=? AND kind='project' ORDER BY created")
    .bind(owner)
    .all();
  const others = res.results
    .filter((r) => String(r.id) !== fallback.id)
    .map((r) => ({ id: String(r.id), project: parseProjectData(r.data) }));
  return [fallback, ...others];
}

async function mutateRow<T, D>(
  db: D1LikeDatabase,
  owner: string,
  kind: "lead" | "project",
  id: string,
  parse: (raw: string) => D,
  fn: (current: D) => { next?: D; result: T },
): Promise<{ result: T; data: D } | null> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await db
      .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind=?")
      .bind(owner, id, kind)
      .first<{ data: string }>();
    if (!row) return null;
    const { next, result } = fn(parse(String(row.data)));
    if (!next) return { result, data: parse(String(row.data)) };
    const upd = await db
      .prepare("UPDATE records SET data=? WHERE owner=? AND id=? AND kind=? AND data=?")
      .bind(JSON.stringify(next), owner, id, kind, String(row.data))
      .run();
    if (upd.meta.changes) return { result, data: next };
  }
  throw new RecordUpdateConflictError(kind === "lead" ? "Лид одновременно изменён — повторите" : "Проект одновременно изменён — повторите");
}

/**
 * Re-reads the lead, applies `fn` and writes only if the row is unchanged since the read (retries on a race).
 * `fn` returns `next` to write (or none to skip the write) and a result; null when the lead is gone.
 */
export async function mutateLead<T>(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  fn: (lead: LeadData) => { next?: LeadData; result: T },
): Promise<{ result: T; lead: LeadData } | null> {
  const done = await mutateRow(db, owner, "lead", id, (raw) => JSON.parse(raw) as LeadData, fn);
  return done ? { result: done.result, lead: done.data } : null;
}

/** Compare-and-set update of an existing project row (the default one must exist: use `findOwnedProject` first). */
export async function mutateProject(
  db: D1LikeDatabase,
  owner: string,
  id: string,
  fn: (project: ProjectData) => ProjectData,
): Promise<ProjectData | null> {
  const done = await mutateRow(db, owner, "project", id, parseProjectData, (p) => ({ next: fn(p), result: null }));
  return done ? done.data : null;
}

/** A lead without draft text and draft kind (`dismiss_draft`, successful send). */
export function withoutDraft(lead: LeadData): LeadData {
  const next: LeadData = { ...lead, draft: "" };
  delete next.draftKind;
  return next;
}

export function dailyCapOf(settings: Record<string, unknown>, kind: DailyCapKind): number {
  const raw = Number(kind === "judge-day" ? settings.judgeDailyCap : settings.draftDailyCap);
  const fallback = kind === "judge-day" ? DEFAULT_JUDGE_DAILY_CAP : DEFAULT_DRAFT_DAILY_CAP;
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/**
 * Reserves `count` units of today's per-owner cap in one atomic statement on the `ai_guard` row
 * `<kind>:<owner>:<YYYY-MM-DD>`; false when the reservation would exceed `cap`.
 */
export async function reserveDailyCap(
  db: D1LikeDatabase,
  owner: string,
  kind: DailyCapKind,
  cap: number,
  count: number,
  nowMs: number,
): Promise<boolean> {
  if (count <= 0) return true;
  if (count > cap) return false;
  const res = await db
    .prepare(
      "INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,'ai_guard',json_object('count',?),?) " +
        "ON CONFLICT(id) DO UPDATE SET data=json_set(records.data,'$.count',COALESCE(json_extract(records.data,'$.count'),0)+?) " +
        "WHERE records.owner=? AND records.kind='ai_guard' AND COALESCE(json_extract(records.data,'$.count'),0)+?<=?",
    )
    .bind(`${kind}:${owner}:${dayKey(nowMs)}`, owner, count, new Date(nowMs).toISOString(), count, owner, count, cap)
    .run();
  return res.meta.changes === 1;
}

/**
 * Owner-level funnel id of the DM pass. Record ids are global, so it carries the owner
 * (`scan-day:dm:<owner>:<day>`); the `funnel` action returns it as `dm`.
 */
export function dmFunnelId(owner: string): string {
  return `dm:${owner}`;
}
