/** Projects (REQ-1, REQ-2, REQ-21): `records kind='project'`, schema, default project from settings, feedback. */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { D1LikeDatabase } from "@/lib/db";
import { findStopWord, MAX_STOP_WORD_LENGTH } from "@/lib/leads/filter";

export const MAX_PROJECTS_PER_OWNER = 10;
export const MAX_KEYWORDS = 30;
export const MAX_STOP_WORDS = 50;
export const MAX_EXAMPLES = 10;
export const EXAMPLE_MAX_LENGTH = 300;
export const DEFAULT_PROJECT_NAME = "Основной проект";

const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/** RFC 4122 v5 UUID (SHA-1 of namespace bytes + name). */
export function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (ns.length !== 16) throw new Error("uuidv5: namespace must be a UUID");
  const bytes = createHash("sha1").update(ns).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DEFAULT_PROJECT_NAMESPACE = uuidv5("unilab-default-project", NAMESPACE_URL);

/** Stable id of the owner's default project (`uuidv5(owner, 'unilab-default-project')`). */
export function defaultProjectId(owner: string): string {
  return uuidv5(owner, DEFAULT_PROJECT_NAMESPACE);
}

/** A group/lead without `projectId` belongs to the default project (no bulk rewrite, REQ-2). */
export function projectIdOf(record: { projectId?: unknown }, owner: string): string {
  const id = typeof record.projectId === "string" ? record.projectId.trim() : "";
  return id || defaultProjectId(owner);
}

const text = (max: number) => z.string().max(max);
const term = z.string().trim().min(1).max(MAX_STOP_WORD_LENGTH);
const example = z.string().trim().min(1).max(EXAMPLE_MAX_LENGTH);

const projectFields = {
  name: z.string().trim().min(1).max(120),
  url: text(500),
  product: text(12000),
  audience: text(2000),
  leadCriteria: text(4000),
  notLead: text(4000),
  valueProps: text(4000),
  tone: text(500),
  cta: text(500),
  keywords: z.array(term).max(MAX_KEYWORDS),
  stopWords: z.array(term).max(MAX_STOP_WORDS),
  goodExamples: z.array(example).max(MAX_EXAMPLES),
  badExamples: z.array(example).max(MAX_EXAMPLES),
  minScore: z.number().int().min(0).max(100),
  scanDepthDays: z.number().int().min(1).max(30),
  autoDraft: z.boolean(),
  active: z.boolean(),
};

/** Stored project card (contract `project` data); unknown keys are stripped. */
export const projectSchema = z.object({
  name: projectFields.name,
  url: projectFields.url.default(""),
  product: projectFields.product.default(""),
  audience: projectFields.audience.default(""),
  leadCriteria: projectFields.leadCriteria.default(""),
  notLead: projectFields.notLead.default(""),
  valueProps: projectFields.valueProps.default(""),
  tone: projectFields.tone.default(""),
  cta: projectFields.cta.default(""),
  keywords: projectFields.keywords.default([]),
  stopWords: projectFields.stopWords.default([]),
  goodExamples: projectFields.goodExamples.default([]),
  badExamples: projectFields.badExamples.default([]),
  minScore: projectFields.minScore.default(50),
  scanDepthDays: projectFields.scanDepthDays.default(7),
  autoDraft: projectFields.autoDraft.default(true),
  active: projectFields.active.default(true),
  updatedAt: z.string().max(40).default(""),
});
export type ProjectData = z.infer<typeof projectSchema>;

/** `project_update` field patch: any subset of editable fields, nothing else. */
export const projectPatchSchema = z.object(projectFields).partial().strict();
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

export function applyProjectPatch(project: ProjectData, patch: ProjectPatch, nowMs: number): ProjectData {
  return projectSchema.parse({ ...project, ...patch, updatedAt: new Date(nowMs).toISOString() });
}

/** Hash of the fields the judge reads; a change invalidates the AI-reject memory. */
export function projectSignature(p: ProjectData): string {
  const src = JSON.stringify([
    p.product, p.audience, p.leadCriteria, p.notLead, p.valueProps, p.keywords,
    p.stopWords, p.goodExamples, p.badExamples, p.minScore,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function splitList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const t = part.trim().toLowerCase().slice(0, MAX_STOP_WORD_LENGTH);
    if (t) seen.add(t);
  }
  return [...seen];
}

function textOf(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.slice(0, max) : "";
}

/**
 * Default project from legacy `settings` (REQ-2). Stop words that occur in the positive card text
 * (product words learned as minus by the old auto-training) are dropped; the list is capped at 50.
 */
export function defaultProjectFromSettings(settings: Record<string, unknown>, nowMs: number): ProjectData {
  const product = textOf(settings.product, 12000);
  const audience = textOf(settings.audience, 2000);
  const leadCriteria = textOf(settings.leadCriteria, 4000);
  const keywords = splitList(settings.keywords).slice(0, MAX_KEYWORDS);
  const positive = [product, audience, leadCriteria, keywords.join(", ")].join("\n");
  const stopWords = splitList(settings.minusKeywords)
    .filter((w) => !findStopWord(positive, [w]))
    .slice(0, MAX_STOP_WORDS);
  const depth = Math.round(Number(settings.scanDepthDays)) || 7;
  return projectSchema.parse({
    name: textOf(settings.name, 120).trim() || DEFAULT_PROJECT_NAME,
    url: textOf(settings.projectUrl, 500),
    product,
    audience,
    leadCriteria,
    notLead: textOf(settings.avoidTopics, 4000),
    valueProps: textOf(settings.valueProps, 4000),
    tone: textOf(settings.tone, 500),
    cta: textOf(settings.cta, 500),
    keywords,
    stopWords,
    scanDepthDays: Math.max(1, Math.min(30, depth)),
    updatedAt: new Date(nowMs).toISOString(),
  });
}

/** REQ-21: feedback adds the lead text as a FIFO example (≤10, ≤300 chars); stop words never change. */
export function addFeedbackExample(project: ProjectData, verdict: "good" | "bad", leadText: string): ProjectData {
  const textOfLead = leadText.replace(/\s+/g, " ").trim().slice(0, EXAMPLE_MAX_LENGTH);
  if (!textOfLead) return project;
  const key = verdict === "good" ? "goodExamples" : "badExamples";
  const list = [...project[key].filter((e) => e !== textOfLead), textOfLead].slice(-MAX_EXAMPLES);
  return { ...project, [key]: list };
}

export type ProjectRow = { id: string; project: ProjectData };

/** Parses a stored project row; a broken row falls back to a minimal valid card instead of throwing. */
export function parseProjectData(raw: unknown): ProjectData {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  const parsed = projectSchema.safeParse(data);
  return parsed.success ? parsed.data : projectSchema.parse({ name: DEFAULT_PROJECT_NAME });
}

/** Lazily creates the owner's default project from `settings` (`INSERT OR IGNORE`, never overwrites). */
export async function ensureDefaultProject(
  db: D1LikeDatabase,
  owner: string,
  settings: Record<string, unknown>,
  nowMs: number,
): Promise<ProjectRow> {
  const id = defaultProjectId(owner);
  const fresh = defaultProjectFromSettings(settings, nowMs);
  await db
    .prepare("INSERT OR IGNORE INTO records(id,owner,kind,data,created) VALUES(?,?,'project',?,?)")
    .bind(id, owner, JSON.stringify(fresh), new Date(nowMs).toISOString())
    .run();
  const row = await db
    .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='project'")
    .bind(id, owner)
    .first<{ data: string }>();
  if (!row) throw new Error("default project id is taken by another record");
  return { id, project: parseProjectData(row.data) };
}
