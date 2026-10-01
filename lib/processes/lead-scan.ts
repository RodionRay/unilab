/**
 * Glue between the pure lead core (`lib/leads`) and D1 for the workspace route (docs/leads-pipeline.md):
 * group scan → leads + `scan_day`, DM pass → leads + `scan_day`, auto drafts of hot leads.
 * Message texts are never logged.
 */

import { AiJsonError, aiChatText, deepseekJsonText, jsonLlmFrom, type TextLlm } from "@/lib/ai-client";
import type { D1LikeDatabase } from "@/lib/db";
import { leadReplies, type LeadData } from "@/lib/lead-conversation";
import { leadMessageFingerprint } from "@/lib/lead-filter";
import {
  defaultProjectId,
  generateDraft,
  HOT_SCORE,
  runDmJudge,
  pruneScanDays,
  runGroupScan,
  upsertScanDay,
  type DmMessage,
  type DraftKind,
  type DraftLead,
  type GroupScanResult,
  type JudgeGate,
  type JudgeLlm,
  type NewLead,
  type ProjectRow,
  type ScanDelta,
  type WorkerScanResult,
} from "@/lib/leads";
import { dailyCapOf, dmFunnelId, listProjects, mutateLead, reserveDailyCap } from "@/lib/processes/lead-store";

/** REQ-18: hot leads drafted automatically per scan / DM pass. */
export const AUTO_DRAFTS_PER_RUN = 3;

export type InsertedLead = { id: string; lead: NewLead };

/**
 * Judge LLM (35 s, one retry). A retry is a second paid call, so it reserves the daily judge cap
 * again for the `units` the caller judges; without room the batch fails (`judgeError`) and the cursor rewinds.
 */
export function judgeLlm(apiKey: string, gate?: JudgeGate): JudgeLlm | null {
  if (!apiKey) return null;
  const text = deepseekJsonText({ apiKey });
  return (schema, prompt, units) => {
    const beforeRetry = gate
      ? async () => {
          if (!(await gate(units))) throw new AiJsonError("AI: daily judge cap reached before retry", 1);
        }
      : undefined;
    return jsonLlmFrom(text, 1, beforeRetry)(schema, prompt);
  };
}

export function draftLlm(apiKey: string): TextLlm {
  return (prompt) => aiChatText({ apiKey, ...prompt });
}

function logError(context: string, e: unknown): void {
  console.error(`[workspace] ${context}:`, String((e as Error)?.message || e).slice(0, 300));
}

type KnownLeads = { fingerprints: Set<string>; senderIds: Set<string> };

/** Dedupe keys of every lead of the owner (only the four fields, not the whole rows). */
async function loadKnownLeads(db: D1LikeDatabase, owner: string): Promise<KnownLeads> {
  const res = await db
    .prepare(
      "SELECT json_extract(data,'$.message') AS message,json_extract(data,'$.groupId') AS groupId," +
        "json_extract(data,'$.tgMsgId') AS tgMsgId,json_extract(data,'$.senderId') AS senderId " +
        "FROM records WHERE owner=? AND kind='lead'",
    )
    .bind(owner)
    .all();
  const known: KnownLeads = { fingerprints: new Set(), senderIds: new Set() };
  for (const r of res.results) {
    known.fingerprints.add(leadMessageFingerprint(String(r.message ?? ""), String(r.groupId ?? ""), String(r.tgMsgId ?? "")));
    const sender = String(r.senderId ?? "").trim();
    if (sender) known.senderIds.add(sender);
  }
  return known;
}

async function insertLeads(db: D1LikeDatabase, owner: string, leads: readonly NewLead[], nowMs: number): Promise<InsertedLead[]> {
  const out: InsertedLead[] = [];
  for (const lead of leads) {
    const id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,'lead',?,NULL,?)")
      .bind(id, owner, JSON.stringify(lead), new Date(nowMs).toISOString())
      .run();
    out.push({ id, lead });
  }
  return out;
}

/**
 * Writes today's funnel row and prunes the owner's rows past retention. A funnel failure must not
 * fail the scan that already stored its leads.
 */
async function recordFunnel(db: D1LikeDatabase, owner: string, projectId: string, delta: ScanDelta, nowMs: number): Promise<void> {
  try {
    await upsertScanDay(db, owner, projectId, delta, nowMs);
    await pruneScanDays(db, owner, nowMs);
  } catch (e) {
    logError("scan_day", e);
  }
}

function judgeGate(db: D1LikeDatabase, owner: string, settings: Record<string, unknown>, nowMs: number) {
  const cap = dailyCapOf(settings, "judge-day");
  return (count: number) => reserveDailyCap(db, owner, "judge-day", cap, count, nowMs);
}

export type GroupScanInput = {
  owner: string;
  groupId: string;
  group: Record<string, unknown>;
  /** Lead `source`: chat title, else group name / url. */
  source: string;
  worker: WorkerScanResult;
  project: ProjectRow;
  settings: Record<string, unknown>;
  apiKey: string;
  nowMs: number;
};

export type GroupScanOutcome = { scan: GroupScanResult; inserted: InsertedLead[] };

/** REQ-6..13: filter → judge → leads of the group's project, today's `scan_day` row updated. */
export async function scanGroupLeads(db: D1LikeDatabase, input: GroupScanInput): Promise<GroupScanOutcome> {
  const { owner, group, project, nowMs } = input;
  const known = await loadKnownLeads(db, owner);
  const gate = judgeGate(db, owner, input.settings, nowMs);
  const scan = await runGroupScan({
    projectId: project.id,
    project: project.project,
    group: {
      id: input.groupId,
      name: input.source,
      accountId: String(group.joinedAccountId || group.accountId || ""),
      scanCursor: String(group.scanCursor || ""),
      aiRejected: group.aiRejected,
      leadTombstones: group.leadTombstones,
      judgeFailStreak: group.judgeFailStreak,
    },
    worker: input.worker,
    knownFingerprints: known.fingerprints,
    llm: judgeLlm(input.apiKey, gate),
    gate,
    now: () => nowMs,
    notifyEnabled: !!input.settings.notifyEnabled,
  });
  if (scan.judgeError) logError("lead_judge", scan.judgeError);
  const inserted = await insertLeads(db, owner, scan.leads, nowMs);
  await recordFunnel(db, owner, project.id, scan.delta, nowMs);
  return { scan, inserted };
}

export type OwnAccounts = { userIds: ReadonlySet<string>; usernames: ReadonlySet<string> };

/** Telegram ids / usernames of the owner's accounts: DMs between them are never leads (REQ-15). */
export async function loadOwnAccounts(db: D1LikeDatabase, owner: string): Promise<OwnAccounts> {
  const res = await db
    .prepare(
      "SELECT json_extract(data,'$.username') AS username,json_extract(data,'$.tgUserId') AS tgUserId " +
        "FROM records WHERE owner=? AND kind='account'",
    )
    .bind(owner)
    .all();
  const userIds = new Set<string>();
  const usernames = new Set<string>();
  for (const r of res.results) {
    const id = String(r.tgUserId ?? "").trim();
    const name = String(r.username ?? "").trim().replace(/^@/, "").toLowerCase();
    if (id) userIds.add(id);
    if (name) usernames.add(name);
  }
  return { userIds, usernames };
}

export type DmPassInput = {
  owner: string;
  messages: readonly DmMessage[];
  settingsId: string | null;
  settings: Record<string, unknown>;
  apiKey: string;
  nowMs: number;
};

export type DmPassOutcome = { inserted: InsertedLead[]; projects: ProjectRow[]; judgeError: string };

/**
 * REQ-15/16: one judge call for the unmatched DMs of a poll pass. A failed or skipped judge is only
 * counted; the caller has already advanced the inbox cursors.
 */
export async function judgeInboxDms(db: D1LikeDatabase, input: DmPassInput): Promise<DmPassOutcome> {
  const { owner, settings, nowMs } = input;
  const [projects, known, ownAccounts] = await Promise.all([
    listProjects(db, owner, settings, nowMs),
    loadKnownLeads(db, owner),
    loadOwnAccounts(db, owner),
  ]);
  const gate = judgeGate(db, owner, settings, nowMs);
  const run = await runDmJudge({
    projects,
    messages: input.messages,
    ownAccounts,
    knownSenderIds: known.senderIds,
    aiRejected: settings.dmAiRejected,
    llm: judgeLlm(input.apiKey, gate),
    gate,
    now: () => nowMs,
    notifyEnabled: !!settings.notifyEnabled,
  });
  if (run.judgeError) logError("dm_judge", run.judgeError);
  const inserted = await insertLeads(db, owner, run.leads, nowMs);
  if (run.delta.counts.fetched) await recordFunnel(db, owner, dmFunnelId(owner), run.delta, nowMs);
  if (input.settingsId) {
    await db
      .prepare("UPDATE records SET data=json_set(data,'$.dmAiRejected',json(?)) WHERE owner=? AND id=? AND kind='settings'")
      .bind(JSON.stringify(run.aiRejected), owner, input.settingsId)
      .run();
  }
  return { inserted, projects, judgeError: run.judgeError };
}

/** Kind of an automatic draft: a DM lead is already a conversation, a group lead gets a first DM. */
export function autoDraftKind(lead: LeadData): DraftKind {
  return lead.sourceKind === "dm" || lead.conversationOpen === true ? "dm_continue" : "dm_first";
}

export function draftLeadOf(lead: LeadData): DraftLead {
  return {
    name: String(lead.name ?? ""),
    message: String(lead.message ?? ""),
    source: String(lead.source ?? ""),
    replies: leadReplies(lead)
      .filter((r) => r.ok !== false && r.text)
      .map((r) => ({ from: r.from === "client" ? "client" : "us", text: String(r.text), at: String(r.at ?? "") })),
  };
}

/** REQ-18: hot leads of projects with `autoDraft`, at most `AUTO_DRAFTS_PER_RUN`. */
export function autoDraftCandidates(projects: readonly ProjectRow[], inserted: readonly InsertedLead[]): InsertedLead[] {
  const auto = new Set(projects.filter((p) => p.project.autoDraft).map((p) => p.id));
  return inserted.filter((l) => l.lead.score >= HOT_SCORE && auto.has(l.lead.projectId)).slice(0, AUTO_DRAFTS_PER_RUN);
}

export type AutoDraftInput = {
  owner: string;
  leads: readonly InsertedLead[];
  projects: readonly ProjectRow[];
  settings: Record<string, unknown>;
  apiKey: string;
  nowMs: number;
  llm?: TextLlm;
};

/**
 * Drafts the given hot leads (after the response). Each draft reserves the daily draft cap; a draft
 * the owner already typed is never overwritten. Nothing is sent.
 */
export async function autoDraftLeads(db: D1LikeDatabase, input: AutoDraftInput): Promise<number> {
  if (!input.apiKey || !input.leads.length) return 0;
  const llm = input.llm ?? draftLlm(input.apiKey);
  const cap = dailyCapOf(input.settings, "draft-day");
  const byId = new Map(input.projects.map((p) => [p.id, p.project]));
  const fallback = byId.get(defaultProjectId(input.owner));
  let drafted = 0;
  for (const { id, lead } of input.leads) {
    // A lead of a missing project reads as the default project (REQ-2).
    const project = byId.get(lead.projectId) ?? fallback;
    if (!project) continue;
    if (!(await reserveDailyCap(db, input.owner, "draft-day", cap, 1, input.nowMs))) break;
    try {
      const kind = autoDraftKind(lead);
      const text = await generateDraft(kind, project, draftLeadOf(lead), llm);
      const done = await mutateLead(db, input.owner, id, (cur) =>
        String(cur.draft ?? "").trim() ? { result: false } : { next: { ...cur, draft: text, draftKind: kind }, result: true },
      );
      if (done?.result) drafted++;
    } catch (e) {
      logError("auto_draft", e);
    }
  }
  return drafted;
}
