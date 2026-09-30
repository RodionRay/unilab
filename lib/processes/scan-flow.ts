/** Решения скана групп / отбора лидов (app/api/workspace/route.ts::scan_group). */

import { isDayLimitCooldown, isAccountUsable } from "@/lib/telegram-accounts";
import {
  explainLeadDecision,
  reasonFromCore,
  temperatureFromScore,
  type LeadCoreSettings,
  type LeadScoreResult,
} from "@/lib/lead-core";
import type { LeadTemperature } from "@/lib/lead-filter";

export type ScanGateResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hard_dead" | "missing"; waitSec?: number; message: string };

const HARD_DEAD = new Set([
  "disconnected",
  "unauthorized",
  "frozen",
  "spamblock",
  "proxy_error",
]);

/** Можно ли сканить группу с этого аккаунта. */
export function evaluateScanGate(account: {
  status?: string | null;
  cooldownUntil?: string | null;
} | null): ScanGateResult {
  if (!account) {
    return { ok: false, reason: "missing", message: "Аккаунт группы не найден" };
  }
  const st = String(account.status || "");
  if (isDayLimitCooldown(account) || st === "spamblock" || st === "frozen") {
    const until = String(account.cooldownUntil || "");
    const waitSec = Math.max(
      60,
      Math.ceil((Date.parse(until) - Date.now()) / 1000) || 300,
    );
    return {
      ok: false,
      reason: "cooldown",
      waitSec,
      message: "Аккаунт на отлёжке — скан позже",
    };
  }
  if (HARD_DEAD.has(st) || !isAccountUsable(account)) {
    return {
      ok: false,
      reason: "hard_dead",
      message: "Аккаунт недоступен — нужна пересадка",
    };
  }
  return { ok: true };
}

export type ScanLeadDecision = {
  pass: boolean;
  temperature: LeadTemperature | null;
  summary: string;
  core: LeadScoreResult;
};

/** Решение ядра: писать ли лид из текста сообщения. */
export function decideScanLead(
  message: string,
  settings: LeadCoreSettings,
): ScanLeadDecision {
  const d = explainLeadDecision(message, settings);
  return {
    pass: d.pass,
    temperature: d.pass ? d.temperature : null,
    summary: d.summary || d.rejectReason || "",
    core: d,
  };
}

export type AiPick = { tgMsgId: string; reason: string; temperature: LeadTemperature };
/** One AI request: `ok` = the model answered with a parseable list (an empty list is a verdict). */
export type AiBatchOutcome = { ids: string[]; ok: boolean; picked: AiPick[] };
export type ScanCandidate = { tgMsgId: string; core: LeadScoreResult };
export type KeptLead = { tgMsgId: string; temperature: "hot" | "warm"; reason: string };

function coreReason(core: LeadScoreResult, temperature: LeadTemperature, aiReason = ""): string {
  return reasonFromCore(
    { ...core, pass: true, temperature, summary: "", fingerprint: "", text: "" },
    aiReason,
  );
}

/**
 * REQ-L1: a batch the AI answered is trusted (unpicked = rejected, `[]` rejects the whole batch);
 * candidates of failed batches, or all of them without AI (`batches` null), fall back to the core.
 * AI never raises a lead above the core: core warm stays warm.
 */
export function applyAiVerdicts(
  candidates: readonly ScanCandidate[],
  batches: readonly AiBatchOutcome[] | null,
): { kept: KeptLead[]; rejectedIds: string[] } {
  const kept: KeptLead[] = [];
  const rejectedIds: string[] = [];
  for (const c of candidates) {
    const coreTemp = temperatureFromScore(c.core);
    if (coreTemp !== "hot" && coreTemp !== "warm") continue;
    const batch = batches?.find((b) => b.ids.includes(c.tgMsgId));
    if (!batch || !batch.ok) {
      kept.push({ tgMsgId: c.tgMsgId, temperature: coreTemp, reason: coreReason(c.core, coreTemp) });
      continue;
    }
    const pick = batch.picked.find((p) => p.tgMsgId === c.tgMsgId);
    if (!pick) {
      rejectedIds.push(c.tgMsgId);
      continue;
    }
    const temperature = coreTemp === "warm" ? "warm" : pick.temperature === "hot" ? "hot" : "warm";
    kept.push({ tgMsgId: c.tgMsgId, temperature, reason: coreReason(c.core, temperature, pick.reason) });
  }
  return { kept, rejectedIds };
}

/** REQ-L11: AI-rejected message ids per group, valid for the settings they were judged under. */
export type AiRejectMemory = { sig: string; until: Record<string, string> };
export const AI_REJECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_AI_REJECTS = 1000;

/** Fingerprint of the settings the AI judges by; a change invalidates remembered rejections. */
export function aiSettingsSignature(settings: Record<string, unknown>): string {
  const src = ["product", "audience", "leadCriteria", "keywords", "hotSignals", "minusKeywords", "avoidTopics", "learnExamples"]
    .map((k) => String(settings[k] ?? ""))
    .join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Unexpired rejections judged under `sig`; anything else (old settings, garbage) is dropped. */
export function activeAiRejects(memory: unknown, sig: string, now: number): Record<string, string> {
  const m = memory as Partial<AiRejectMemory> | null;
  if (!m || m.sig !== sig || !m.until || typeof m.until !== "object") return {};
  const out: Record<string, string> = {};
  for (const [id, until] of Object.entries(m.until)) {
    if (typeof until === "string" && Date.parse(until) > now) out[id] = until;
  }
  return out;
}

export function rememberAiRejects(
  active: Record<string, string>,
  ids: readonly string[],
  sig: string,
  now: number,
): AiRejectMemory {
  const until = new Date(now + AI_REJECT_TTL_MS).toISOString();
  const merged = { ...active };
  for (const id of ids) if (id) merged[id] = until;
  const entries = Object.entries(merged).sort((a, b) => a[1].localeCompare(b[1]));
  return { sig, until: Object.fromEntries(entries.slice(-MAX_AI_REJECTS)) };
}

/** REQ-L6: message ids of leads the user deleted; the scan dedupe treats them as existing. */
export const MAX_LEAD_TOMBSTONES = 2000;

export function addLeadTombstone(list: unknown, tgMsgId: string): string[] {
  const prev = Array.isArray(list) ? list.map(String) : [];
  if (!tgMsgId || prev.includes(tgMsgId)) return prev;
  return [...prev, tgMsgId].slice(-MAX_LEAD_TOMBSTONES);
}

/**
 * REQ-L10 / REQ-L7: fields the server owns; a client save (stale copy or zod-stripped) never
 * overwrites them. Lead: conversation, sender and scan data. Group: scan lock, cursor, memories.
 */
const SERVER_OWNED: Record<"lead" | "group", readonly string[]> = {
  lead: [
    "replies", "needsManager", "incomingLastText", "conversationOpen", "conversationAt",
    "coreScore", "notifyPending", "notifiedAt", "notifyAttempts", "notifyClaimUntil",
    "senderId", "senderUsername", "senderAccessHash", "peerId", "replyToMsgId", "messageKind",
    "tgMsgId", "groupId", "accountId", "mailingTaskId",
  ],
  group: ["scanLockUntil", "scanLockToken", "scanCursor", "aiRejected", "leadTombstones"],
};

export function keepServerOwnedFields(
  kind: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const fields = kind === "lead" || kind === "group" ? SERVER_OWNED[kind] : [];
  const out = { ...next };
  for (const f of fields) {
    if (f in prev) out[f] = prev[f];
  }
  return out;
}
