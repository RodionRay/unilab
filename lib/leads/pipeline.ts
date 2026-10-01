/**
 * Lead pipelines (M1 walking skeleton): worker result → filter → judge → lead objects → `scan_day` delta.
 * Pure apart from the injected LLM / daily-cap gate / clock; the route does every DB write.
 */

import type { JsonLlm } from "@/lib/ai-client";
import type { ReplyEntry } from "@/lib/lead-conversation";
import { groupDmSenders, judgeDmSenders, type DmMessage, type DmSender } from "@/lib/leads/dm-judge";
import { addSample, emptyCounts } from "@/lib/leads/funnel";
import { filterMessages, normalizeScanMessage } from "@/lib/leads/filter";
import { compareMsgIds, judgeMessages } from "@/lib/leads/judge";
import { projectSignature, type ProjectData, type ProjectRow } from "@/lib/leads/projects";
import { activeAiRejects, rememberAiRejects, type AiRejectMemory } from "@/lib/leads/reject-memory";
import type { FunnelCounts, JudgeGate, ScanDelta, ScanMessage, SourceKind } from "@/lib/leads/types";

export const HOT_SCORE = 80;
export const DM_SOURCE = "Личные сообщения";
const RUN_LINE_MAX = 200;
const DM_DEFAULT_DEPTH_DAYS = 30;

/** Raw worker `/scan-group` answer (REQ-5 fields). */
export type WorkerScanResult = {
  messages?: unknown;
  fetched?: unknown;
  skippedNotUser?: unknown;
  skippedOld?: unknown;
  skippedError?: unknown;
  cursor?: unknown;
  scanMode?: unknown;
};

export type GroupScanDeps = {
  projectId: string;
  project: ProjectData;
  group: { id: string; name: string; accountId: string; scanCursor: string; aiRejected: unknown; leadTombstones: unknown };
  worker: WorkerScanResult;
  /** `leadMessageFingerprint` of the owner's existing leads. */
  knownFingerprints: ReadonlySet<string>;
  llm: JsonLlm | null;
  gate?: JudgeGate;
  now: () => number;
  notifyEnabled: boolean;
};

/** Lead record data to insert (`records kind='lead'`); the caller assigns the row id. */
export type NewLead = {
  name: string;
  message: string;
  source: string;
  status: "new";
  temperature: "hot" | "warm";
  draft: "";
  tgMsgId: string;
  groupId: string;
  projectId: string;
  score: number;
  reason: string;
  sourceKind: SourceKind;
  viewed: false;
  viewedAt: "";
  excludeFromTraining: false;
  senderId: string;
  senderUsername: string;
  senderAccessHash: string;
  messageKind: string;
  peerId: string;
  replyToMsgId: string;
  replies: ReplyEntry[];
  accountId: string;
  notifyPending: boolean;
  notifiedAt: "";
  conversationOpen?: true;
  conversationAt?: string;
};

export type GroupScanResult = {
  leads: NewLead[];
  aiRejected: AiRejectMemory;
  nextCursor: string;
  delta: ScanDelta;
  /** Judge error of this run ("" when none); never contains message text. */
  judgeError: string;
};

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function temperatureOf(score: number): "hot" | "warm" {
  return score >= HOT_SCORE ? "hot" : "warm";
}

function clockLabel(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(11, 16);
}

function runLine(nowMs: number, label: string, c: FunnelCounts, error: string, skip: string): string {
  const dropped = c.skippedErrorApp + c.old + c.short + c.duplicate + c.stopword;
  const tail = error ? " · ошибка судьи" : skip ? ` · судья пропущен: ${skip}` : "";
  return `${clockLabel(nowMs)} · ${label} · собрано ${c.fetched} · отдано ${c.returned} · отсеяно ${dropped} · судья ${c.judged} · лиды ${c.leads}${tail}`.slice(0, RUN_LINE_MAX);
}

/**
 * REQ-10: cursor rewinds to the smallest unjudged group/discussion id − 1 (comment ids live in another
 * peer and never reach the cursor); otherwise the worker cursor, else the previous one.
 */
export function nextScanCursor(workerCursor: string, prevCursor: string, unjudged: readonly ScanMessage[]): string {
  const ids = unjudged
    .filter((m) => m.messageKind !== "comment")
    .map((m) => m.tgMsgId)
    .filter((id) => /^\d+$/.test(id))
    .sort(compareMsgIds);
  if (ids.length) return String(Math.max(0, Number(ids[0]) - 1));
  return workerCursor || prevCursor;
}

function groupLead(deps: GroupScanDeps, m: ScanMessage, score: number, reason: string): NewLead {
  return {
    name: m.name || "Участник",
    message: m.message,
    source: deps.group.name,
    status: "new",
    temperature: temperatureOf(score),
    draft: "",
    tgMsgId: m.tgMsgId,
    groupId: deps.group.id,
    projectId: deps.projectId,
    score,
    reason,
    sourceKind: m.messageKind || "group",
    viewed: false,
    viewedAt: "",
    excludeFromTraining: false,
    senderId: m.senderId,
    senderUsername: m.senderUsername,
    senderAccessHash: m.senderAccessHash,
    messageKind: m.messageKind,
    peerId: m.peerId,
    replyToMsgId: m.replyToMsgId,
    replies: [],
    accountId: deps.group.accountId,
    notifyPending: deps.notifyEnabled,
    notifiedAt: "",
  };
}

export async function runGroupScan(deps: GroupScanDeps): Promise<GroupScanResult> {
  const now = deps.now();
  const messages = (Array.isArray(deps.worker.messages) ? deps.worker.messages : []).map(normalizeScanMessage);
  const sig = projectSignature(deps.project);
  const active = activeAiRejects(deps.group.aiRejected, sig, now);
  const filtered = filterMessages(messages, {
    now,
    scanDepthDays: deps.project.scanDepthDays,
    groupId: deps.group.id,
    knownFingerprints: deps.knownFingerprints,
    tombstones: Array.isArray(deps.group.leadTombstones) ? deps.group.leadTombstones.map(String) : [],
    aiRejects: active,
    stopWords: deps.project.stopWords,
  });
  const judge = await judgeMessages(deps.project, filtered.passed, deps.llm, { gate: deps.gate });

  const counts = { ...emptyCounts(), ...filtered.counts, ...judge.counts };
  counts.skippedNotUser = count(deps.worker.skippedNotUser);
  counts.skippedOldWorker = count(deps.worker.skippedOld);
  counts.skippedError = count(deps.worker.skippedError);
  counts.returned = messages.length;
  // REQ-13 holds by construction; the worker's own `fetched` is only shown when it disagrees.
  counts.fetched = counts.skippedNotUser + counts.skippedOldWorker + counts.skippedError + counts.returned;
  const samples = { ...filtered.samples };

  const leads: NewLead[] = [];
  const rejectedIds: string[] = [];
  for (const { message, verdict } of judge.judged) {
    if (verdict.isLead && verdict.score >= deps.project.minScore) {
      leads.push(groupLead(deps, message, verdict.score, verdict.reason));
      addSample(samples, "leads", { text: message.message, reason: verdict.reason });
    } else {
      rejectedIds.push(message.tgMsgId);
      addSample(samples, "rejected", { text: message.message, reason: verdict.reason });
    }
  }
  for (const u of judge.unjudged) addSample(samples, u.step, { text: u.message.message, reason: u.reason });
  counts.leads = leads.length;
  counts.rejected = rejectedIds.length;

  const workerFetched = count(deps.worker.fetched);
  const label = deps.group.name + (workerFetched && workerFetched !== counts.fetched ? ` (worker fetched ${workerFetched})` : "");
  const skip = judge.unjudged[0]?.step === "judgeSkipped" ? judge.unjudged[0].reason : "";
  return {
    leads,
    aiRejected: rememberAiRejects(active, rejectedIds, sig, now),
    nextCursor: nextScanCursor(String(deps.worker.cursor ?? ""), deps.group.scanCursor, judge.unjudged.map((u) => u.message)),
    delta: { counts, samples, run: runLine(now, label, counts, judge.error, skip) },
    judgeError: judge.error,
  };
}

export type DmJudgeDeps = {
  /** All projects of the owner; inactive ones are ignored. */
  projects: readonly ProjectRow[];
  messages: readonly DmMessage[];
  ownAccounts: { userIds: ReadonlySet<string>; usernames: ReadonlySet<string> };
  /** userIds that already are leads: not judged again. */
  knownSenderIds: ReadonlySet<string>;
  /** AI-reject memory of the DM pass (keyed `userId:lastMessageId`). */
  aiRejected: unknown;
  llm: JsonLlm | null;
  gate?: JudgeGate;
  now: () => number;
  notifyEnabled: boolean;
};

export type DmJudgeRunResult = {
  leads: NewLead[];
  aiRejected: AiRejectMemory;
  delta: ScanDelta;
  judgeError: string;
};

function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, "").toLowerCase();
}

function dmUnitId(s: DmSender): string {
  return s.lastMessageId ? `${s.userId}:${s.lastMessageId}` : "";
}

function senderAsMessage(s: DmSender): ScanMessage {
  return {
    tgMsgId: dmUnitId(s),
    message: s.text,
    name: s.name,
    date: s.at,
    senderId: s.userId,
    senderUsername: s.username,
    senderAccessHash: "",
    messageKind: "",
    peerId: s.userId,
    replyToMsgId: "",
  };
}

/** A stop word drops a DM only when every active project lists it (DMs are not tied to one project). */
function sharedStopWords(projects: readonly ProjectRow[]): string[] {
  const [first, ...rest] = projects.map((p) => new Set(p.project.stopWords.map((w) => w.trim().toLowerCase())));
  if (!first) return [];
  return [...first].filter((w) => rest.every((set) => set.has(w)));
}

function dmLead(s: DmSender, projectId: string, score: number, reason: string, nowIso: string, notify: boolean): NewLead {
  const link = s.username ? `https://t.me/${s.username.replace(/^@/, "")}` : "";
  return {
    name: s.name || s.username || "Клиент",
    message: s.text,
    source: DM_SOURCE,
    status: "new",
    temperature: temperatureOf(score),
    draft: "",
    tgMsgId: s.lastMessageId,
    groupId: "",
    projectId,
    score,
    reason,
    sourceKind: "dm",
    viewed: false,
    viewedAt: "",
    excludeFromTraining: false,
    senderId: s.userId,
    senderUsername: s.username,
    senderAccessHash: "",
    messageKind: "",
    peerId: s.userId,
    replyToMsgId: "",
    replies: s.messages.map((m) => ({
      text: m.text,
      mode: "dm",
      at: m.at || nowIso,
      ok: true,
      error: "",
      messageId: m.messageId,
      link,
      chatId: s.userId,
      from: "client",
      accountId: m.accountId,
    })),
    accountId: s.accountId,
    notifyPending: notify,
    notifiedAt: "",
    conversationOpen: true,
    conversationAt: nowIso,
  };
}

/** REQ-15/16: one DM pass; a failed or skipped judge is counted and the caller still advances its cursor. */
export async function runDmJudge(deps: DmJudgeDeps): Promise<DmJudgeRunResult> {
  const now = deps.now();
  const nowIso = new Date(now).toISOString();
  const active = deps.projects.filter((p) => p.project.active);
  const ownNames = new Set([...deps.ownAccounts.usernames].map(normalizeUsername).filter(Boolean));
  const senders = groupDmSenders(deps.messages);
  const strangers = senders.filter(
    (s) => !deps.ownAccounts.userIds.has(s.userId) && !(s.username && ownNames.has(normalizeUsername(s.username))),
  );
  const sig = active.map((p) => `${p.id}:${projectSignature(p.project)}`).join(",");
  const remembered = activeAiRejects(deps.aiRejected, sig, now);
  const filtered = filterMessages(strangers.map(senderAsMessage), {
    now,
    scanDepthDays: Math.max(DM_DEFAULT_DEPTH_DAYS, ...active.map((p) => p.project.scanDepthDays)),
    groupId: "dm",
    knownFingerprints: new Set(),
    knownSenderIds: deps.knownSenderIds,
    tombstones: [],
    aiRejects: remembered,
    stopWords: sharedStopWords(active),
  });
  const passedIds = new Set(filtered.passed.map((m) => m.senderId));
  const judge = await judgeDmSenders(active, strangers.filter((s) => passedIds.has(s.userId)), deps.llm, { gate: deps.gate });

  const counts = { ...emptyCounts(), ...filtered.counts };
  counts.skippedNotUser = senders.length - strangers.length;
  counts.returned = strangers.length;
  counts.fetched = senders.length;
  const samples = { ...filtered.samples };
  const minScore = new Map(active.map((p) => [p.id, p.project.minScore]));
  const leads: NewLead[] = [];
  const rejectedIds: string[] = [];
  for (const { sender, verdict } of judge.judged) {
    const threshold = verdict.projectId ? minScore.get(verdict.projectId) : undefined;
    if (verdict.projectId && threshold !== undefined && verdict.score >= threshold) {
      leads.push(dmLead(sender, verdict.projectId, verdict.score, verdict.reason, nowIso, deps.notifyEnabled));
      addSample(samples, "leads", { text: sender.text, reason: verdict.reason });
    } else {
      rejectedIds.push(dmUnitId(sender));
      addSample(samples, "rejected", { text: sender.text, reason: verdict.reason });
    }
  }
  for (const u of judge.unjudged) {
    counts[u.step]++;
    addSample(samples, u.step, { text: u.sender.text, reason: u.reason });
  }
  counts.judged = judge.judged.length;
  counts.leads = leads.length;
  counts.rejected = rejectedIds.length;
  const skip = judge.unjudged[0]?.step === "judgeSkipped" ? judge.unjudged[0].reason : "";
  return {
    leads,
    aiRejected: rememberAiRejects(remembered, rejectedIds, sig, now),
    delta: { counts, samples, run: runLine(now, "ЛС", counts, judge.error, skip) },
    judgeError: judge.error,
  };
}
