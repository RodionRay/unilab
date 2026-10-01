/**
 * Group judge (REQ-8..11): ascending `tgMsgId` batches ≤20, ≤4 per scan, zod-validated JSON answers.
 * The first failed or skipped batch stops judging; everything after it is `judgeSkipped` (`blocked`)
 * and `firstUnjudgedId` tells the pipeline where to rewind the cursor. No non-LLM fallback.
 */

import { z } from "zod";
import type { JsonLlm } from "@/lib/ai-client";
import { buildGroupJudgePrompt } from "@/lib/leads/prompt";
import type { ProjectData } from "@/lib/leads/projects";
import type { JudgeGate, ScanMessage, UnjudgedStep, Verdict } from "@/lib/leads/types";

export const JUDGE_BATCH_SIZE = 20;
export const JUDGE_MAX_BATCHES = 4;
export const REASON_MAX = 200;
export const NO_VERDICT_REASON = "нет вердикта";

const idSchema = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const reasonSchema = z
  .string()
  .default("")
  .transform((s) => s.slice(0, REASON_MAX));

export const judgeAnswerSchema = z.object({
  verdicts: z.array(
    z.object({
      id: idSchema,
      isLead: z.boolean(),
      score: z.number().min(0).max(100).transform(Math.round),
      reason: reasonSchema,
    }),
  ),
});

export type JudgedMessage = { message: ScanMessage; verdict: Verdict };
export type UnjudgedMessage = { message: ScanMessage; step: UnjudgedStep; reason: string };
export type JudgeCounts = { judged: number; judgeSkipped: number; judgeError: number };
export type JudgeResult = {
  judged: JudgedMessage[];
  unjudged: UnjudgedMessage[];
  /** Smallest id not judged in this scan (any kind), null when all were judged. */
  firstUnjudgedId: string | null;
  counts: JudgeCounts;
  /** Error of the failed batch ("" when none); never contains message text. */
  error: string;
};
export type JudgeOptions = { gate?: JudgeGate; batchSize?: number; maxBatches?: number };

type BatchStop = { step: UnjudgedStep; reason: string; error: string };

/** Numeric order for Telegram ids, lexicographic only for non-numeric leftovers. */
export function compareMsgIds(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, REASON_MAX);
}

/** Reserves the daily cap; a throwing gate is an error of this batch, not of the scan. */
export async function checkGate(gate: JudgeGate | undefined, count: number): Promise<BatchStop | null> {
  if (!gate) return null;
  try {
    return (await gate(count)) ? null : { step: "judgeSkipped", reason: "daily_cap", error: "" };
  } catch (e) {
    return { step: "judgeError", reason: errorText(e), error: errorText(e) };
  }
}

async function judgeBatch(
  project: ProjectData,
  batch: readonly ScanMessage[],
  llm: JsonLlm | null,
  gate: JudgeGate | undefined,
): Promise<Map<string, Verdict> | BatchStop> {
  if (!llm) return { step: "judgeSkipped", reason: "no_ai_key", error: "" };
  const capped = await checkGate(gate, batch.length);
  if (capped) return capped;
  try {
    const answer = await llm(judgeAnswerSchema, buildGroupJudgePrompt(project, batch));
    const ids = new Set(batch.map((m) => m.tgMsgId));
    const verdicts = new Map<string, Verdict>();
    for (const v of answer.verdicts) {
      if (ids.has(v.id) && !verdicts.has(v.id)) verdicts.set(v.id, v);
    }
    return verdicts;
  } catch (e) {
    return { step: "judgeError", reason: errorText(e), error: errorText(e) };
  }
}

export async function judgeMessages(
  project: ProjectData,
  messages: readonly ScanMessage[],
  llm: JsonLlm | null,
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const sorted = [...messages].sort((a, b) => compareMsgIds(a.tgMsgId, b.tgMsgId));
  const batches = chunk(sorted, opts.batchSize ?? JUDGE_BATCH_SIZE);
  const maxBatches = opts.maxBatches ?? JUDGE_MAX_BATCHES;
  const judged: JudgedMessage[] = [];
  const unjudged: UnjudgedMessage[] = [];
  let stopped = false;
  let error = "";
  for (const [index, batch] of batches.entries()) {
    if (stopped || index >= maxBatches) {
      const reason = stopped ? "blocked" : "batch_limit";
      for (const message of batch) unjudged.push({ message, step: "judgeSkipped", reason });
      continue;
    }
    const outcome = await judgeBatch(project, batch, llm, opts.gate);
    if (outcome instanceof Map) {
      for (const message of batch) {
        const verdict = outcome.get(message.tgMsgId) ?? { id: message.tgMsgId, isLead: false, score: 0, reason: NO_VERDICT_REASON };
        judged.push({ message, verdict });
      }
      continue;
    }
    stopped = true;
    error = outcome.error;
    for (const message of batch) unjudged.push({ message, step: outcome.step, reason: outcome.reason });
  }
  return {
    judged,
    unjudged,
    firstUnjudgedId: unjudged[0]?.message.tgMsgId ?? null,
    counts: {
      judged: judged.length,
      judgeSkipped: unjudged.filter((u) => u.step === "judgeSkipped").length,
      judgeError: unjudged.filter((u) => u.step === "judgeError").length,
    },
    error,
  };
}
