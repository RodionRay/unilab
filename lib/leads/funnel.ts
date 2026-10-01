/** `scan_day` funnel rows (REQ-12, REQ-13): one row per project per UTC day, counters summed per run. */

import type { D1LikeDatabase } from "@/lib/db";
import {
  FUNNEL_COUNTERS,
  SAMPLE_STEPS,
  type FunnelCounts,
  type FunnelSample,
  type FunnelSamples,
  type SampleStep,
  type ScanDelta,
} from "@/lib/leads/types";

export const MAX_SAMPLES = 3;
export const MAX_RUNS = 20;
export const SAMPLE_TEXT_MAX = 200;
const UPSERT_ATTEMPTS = 5;
/** `scan_day` rows older than this are deleted when a run writes its row. */
export const SCAN_DAY_RETENTION_DAYS = 30;
/** Rows deleted per run at most: pruning stays a bounded side step of a scan. */
export const SCAN_DAY_PRUNE_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ScanDayData = {
  projectId: string;
  day: string;
  counts: FunnelCounts;
  samples: FunnelSamples;
  runs: string[];
};

export type FunnelView = Omit<ScanDayData, "day"> & { days: number };

export function emptyCounts(): FunnelCounts {
  return Object.fromEntries(FUNNEL_COUNTERS.map((k) => [k, 0])) as FunnelCounts;
}

/** UTC `YYYY-MM-DD`. */
export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function scanDayId(projectId: string, day: string): string {
  return `scan-day:${projectId}:${day}`;
}

function clip(text: unknown): string {
  return String(text ?? "").slice(0, SAMPLE_TEXT_MAX);
}

function cleanSample(raw: unknown): FunnelSample | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const out: FunnelSample = { text: clip(s.text) };
  if (s.term) out.term = clip(s.term);
  if (s.reason) out.reason = clip(s.reason);
  return out;
}

/** Adds a sample to a run's delta: the first `MAX_SAMPLES` of a step are kept, texts truncated. */
export function addSample(samples: FunnelSamples, step: SampleStep, sample: FunnelSample): void {
  const list = samples[step] ?? [];
  if (list.length >= MAX_SAMPLES) return;
  const clean = cleanSample(sample);
  if (clean) list.push(clean);
  samples[step] = list;
}

function cleanCounts(raw: unknown): FunnelCounts {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = emptyCounts();
  for (const k of FUNNEL_COUNTERS) {
    const n = Number(src[k]);
    out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

function cleanSamples(raw: unknown): FunnelSamples {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: FunnelSamples = {};
  for (const step of SAMPLE_STEPS) {
    const list = src[step];
    if (!Array.isArray(list)) continue;
    const clean = list.map(cleanSample).filter((s): s is FunnelSample => s !== null);
    if (clean.length) out[step] = clean.slice(-MAX_SAMPLES);
  }
  return out;
}

function cleanRuns(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(clip).slice(-MAX_RUNS) : [];
}

function sumInto(target: FunnelCounts, add: FunnelCounts): void {
  for (const k of FUNNEL_COUNTERS) target[k] += add[k];
}

function appendSamples(target: FunnelSamples, add: FunnelSamples): void {
  for (const step of SAMPLE_STEPS) {
    const extra = add[step];
    if (!extra?.length) continue;
    target[step] = [...(target[step] ?? []), ...extra].slice(-MAX_SAMPLES);
  }
}

/** Day row after one run: counters summed, last 3 samples per step, last 20 run lines. Garbage `prev` = empty. */
export function mergeScanDay(prev: unknown, delta: ScanDelta, projectId: string, day: string): ScanDayData {
  const p = prev && typeof prev === "object" ? (prev as Record<string, unknown>) : {};
  const counts = cleanCounts(p.counts);
  sumInto(counts, cleanCounts(delta.counts));
  const samples = cleanSamples(p.samples);
  appendSamples(samples, cleanSamples(delta.samples));
  const runs = [...cleanRuns(p.runs), clip(delta.run)].slice(-MAX_RUNS);
  return { projectId, day, counts, samples, runs };
}

/** Sums the rows of the last `days` UTC days (today included), oldest first for samples and runs. */
export function aggregateFunnel(rows: readonly unknown[], days: number, nowMs: number): FunnelView {
  const wanted = new Set(Array.from({ length: days }, (_, i) => dayKey(nowMs - i * DAY_MS)));
  const picked = rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => wanted.has(String(r.day)))
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const view: FunnelView = { projectId: "", days, counts: emptyCounts(), samples: {}, runs: [] };
  for (const row of picked) {
    view.projectId = String(row.projectId ?? "");
    sumInto(view.counts, cleanCounts(row.counts));
    appendSamples(view.samples, cleanSamples(row.samples));
    view.runs = [...view.runs, ...cleanRuns(row.runs)].slice(-MAX_RUNS);
  }
  return view;
}

function parseData(raw: unknown): unknown {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/**
 * Merges one run into today's row. Each write is a single compare-and-set statement (insert-if-absent
 * or update-if-unchanged), retried on contention, so concurrent runs never lose counters.
 */
export async function upsertScanDay(
  db: D1LikeDatabase,
  owner: string,
  projectId: string,
  delta: ScanDelta,
  nowMs: number,
): Promise<ScanDayData> {
  const day = dayKey(nowMs);
  const id = scanDayId(projectId, day);
  for (let attempt = 0; attempt < UPSERT_ATTEMPTS; attempt++) {
    const row = await db
      .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='scan_day'")
      .bind(id, owner)
      .first<{ data: string }>();
    const next = mergeScanDay(row ? parseData(row.data) : null, delta, projectId, day);
    const json = JSON.stringify(next);
    const res = row
      ? await db
          .prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='scan_day' AND data=?")
          .bind(json, id, owner, row.data)
          .run()
      : await db
          .prepare("INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,'scan_day',?,?) ON CONFLICT(id) DO NOTHING")
          .bind(id, owner, json, new Date(nowMs).toISOString())
          .run();
    if (res.meta.changes) return next;
  }
  throw new Error(`scan_day upsert failed after ${UPSERT_ATTEMPTS} attempts`);
}

/** Funnel of one project for the last `days` days (action `funnel {projectId, days}`). */
export async function readFunnel(
  db: D1LikeDatabase,
  owner: string,
  projectId: string,
  days: 1 | 7,
  nowMs: number,
): Promise<FunnelView> {
  const ids = Array.from({ length: days }, (_, i) => scanDayId(projectId, dayKey(nowMs - i * DAY_MS)));
  const marks = ids.map(() => "?").join(",");
  const res = await db
    .prepare(`SELECT data FROM records WHERE owner=? AND kind='scan_day' AND id IN (${marks})`)
    .bind(owner, ...ids)
    .all();
  const view = aggregateFunnel(res.results.map((r) => parseData(r.data)), days, nowMs);
  return { ...view, projectId };
}

/**
 * Deletes the owner's `scan_day` rows whose day is older than `SCAN_DAY_RETENTION_DAYS` (at most
 * `SCAN_DAY_PRUNE_LIMIT` per call, owner-scoped); returns how many rows went.
 */
export async function pruneScanDays(db: D1LikeDatabase, owner: string, nowMs: number): Promise<number> {
  const cutoff = dayKey(nowMs - SCAN_DAY_RETENTION_DAYS * DAY_MS);
  const res = await db
    .prepare(
      "DELETE FROM records WHERE owner=? AND kind='scan_day' AND id IN " +
        "(SELECT id FROM records WHERE owner=? AND kind='scan_day' AND json_extract(data,'$.day')<? LIMIT ?)",
    )
    .bind(owner, owner, cutoff, SCAN_DAY_PRUNE_LIMIT)
    .run();
  return res.meta.changes;
}

