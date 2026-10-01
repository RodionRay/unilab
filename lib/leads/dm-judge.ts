/**
 * DM judge (REQ-15, REQ-16): unmatched incoming DMs grouped by userId, ≤20 senders in ≤1 LLM call with
 * every active project card → `{id, projectId|null, score, reason}`. Senders over 20 are `judgeSkipped`.
 */

import { z } from "zod";
import type { JsonLlm } from "@/lib/ai-client";
import { checkGate, compareMsgIds, errorText, NO_VERDICT_REASON, REASON_MAX } from "@/lib/leads/judge";
import type { ProjectRow } from "@/lib/leads/projects";
import { buildDmJudgePrompt } from "@/lib/leads/prompt";
import type { JudgeGate, UnjudgedStep } from "@/lib/leads/types";

export const DM_MAX_SENDERS = 20;
const SENDER_TEXT_MAX = 4000;

/** One incoming DM as returned by the worker `/inbox-dms`, plus the account that received it. */
export type DmMessage = {
  userId: string;
  username: string;
  name: string;
  text: string;
  messageId: string;
  at: string;
  accountId: string;
};

export type DmSender = {
  userId: string;
  username: string;
  name: string;
  accountId: string;
  /** Messages joined oldest first (tail kept when long). */
  text: string;
  lastMessageId: string;
  at: string;
  messages: DmMessage[];
};

export const dmAnswerSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      projectId: z
        .string()
        .nullable()
        .optional()
        .transform((v) => v || null),
      score: z.number().min(0).max(100).transform(Math.round),
      reason: z
        .string()
        .default("")
        .transform((s) => s.slice(0, REASON_MAX)),
    }),
  ),
});

export type DmVerdict = { id: string; projectId: string | null; score: number; reason: string };
export type JudgedSender = { sender: DmSender; verdict: DmVerdict };
export type UnjudgedSender = { sender: DmSender; step: UnjudgedStep; reason: string };
export type DmJudgeResult = { judged: JudgedSender[]; unjudged: UnjudgedSender[]; error: string };

function str(v: unknown, max: number): string {
  return v === null || v === undefined ? "" : String(v).slice(0, max);
}

export function normalizeDmMessage(raw: unknown, accountId: string): DmMessage {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    userId: str(m.userId, 40).trim(),
    username: str(m.username, 64).trim(),
    name: str(m.name, 200),
    text: str(m.text, 4000),
    messageId: str(m.messageId, 40).trim(),
    at: str(m.at, 40),
    accountId,
  };
}

function byTime(a: DmMessage, b: DmMessage): number {
  const ta = Date.parse(a.at) || 0;
  const tb = Date.parse(b.at) || 0;
  return ta !== tb ? ta - tb : compareMsgIds(a.messageId, b.messageId);
}

/** Groups by userId in first-seen order; messages without a userId are dropped. */
export function groupDmSenders(messages: readonly DmMessage[]): DmSender[] {
  const groups = new Map<string, DmMessage[]>();
  for (const m of messages) {
    if (!m.userId) continue;
    groups.set(m.userId, [...(groups.get(m.userId) ?? []), m]);
  }
  return [...groups.entries()].map(([userId, list]) => {
    const sorted = [...list].sort(byTime);
    const last = sorted[sorted.length - 1]!;
    return {
      userId,
      username: last.username,
      name: last.name,
      accountId: last.accountId,
      text: sorted.map((m) => m.text.trim()).filter(Boolean).join("\n").slice(-SENDER_TEXT_MAX),
      lastMessageId: last.messageId,
      at: last.at,
      messages: sorted,
    };
  });
}

function skipAll(senders: readonly DmSender[], step: UnjudgedStep, reason: string): UnjudgedSender[] {
  return senders.map((sender) => ({ sender, step, reason }));
}

export async function judgeDmSenders(
  projects: readonly ProjectRow[],
  senders: readonly DmSender[],
  llm: JsonLlm | null,
  opts: { gate?: JudgeGate } = {},
): Promise<DmJudgeResult> {
  if (!projects.length) return { judged: [], unjudged: skipAll(senders, "judgeSkipped", "no_project"), error: "" };
  const batch = senders.slice(0, DM_MAX_SENDERS);
  const overflow = skipAll(senders.slice(DM_MAX_SENDERS), "judgeSkipped", "sender_limit");
  if (!batch.length) return { judged: [], unjudged: overflow, error: "" };
  if (!llm) return { judged: [], unjudged: [...skipAll(batch, "judgeSkipped", "no_ai_key"), ...overflow], error: "" };
  const capped = await checkGate(opts.gate, batch.length);
  if (capped) return { judged: [], unjudged: [...skipAll(batch, capped.step, capped.reason), ...overflow], error: capped.error };
  try {
    const prompt = buildDmJudgePrompt(projects, batch.map((s) => ({ id: s.userId, name: s.name, text: s.text })));
    const answer = await llm(dmAnswerSchema, prompt);
    const projectIds = new Set(projects.map((p) => p.id));
    const byId = new Map<string, DmVerdict>();
    for (const v of answer.verdicts) {
      if (byId.has(v.id)) continue;
      byId.set(v.id, { ...v, projectId: v.projectId && projectIds.has(v.projectId) ? v.projectId : null });
    }
    const judged = batch.map((sender) => ({
      sender,
      verdict: byId.get(sender.userId) ?? { id: sender.userId, projectId: null, score: 0, reason: NO_VERDICT_REASON },
    }));
    return { judged, unjudged: overflow, error: "" };
  } catch (e) {
    return { judged: [], unjudged: [...skipAll(batch, "judgeError", errorText(e)), ...overflow], error: errorText(e) };
  }
}
