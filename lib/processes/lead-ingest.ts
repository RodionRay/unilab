/**
 * Platform-neutral lead selection: depth → core prefilter → dedup → AI-reject memory → AI → verdict.
 * Used by app/api/workspace/route.ts::scan_group (Telegram) and the VK scan; I/O stays with the caller.
 */

import type { LeadCoreSettings, LeadScoreResult } from "@/lib/lead-core";
import { applyAiVerdicts, decideScanLead, type AiBatchOutcome } from "@/lib/processes/scan-flow";

/** `key` identifies the item for dedup, AI ids and AI-reject memory (Telegram: tgMsgId, VK: msgKey). */
export type IngestItem = { key: string; message: string; name: string; date?: string | undefined };

/** Shape lib/processes/lead-ai.ts::qualifyLeadsWithAi expects; `tgMsgId` carries the item key. */
export type QualifyInput = { tgMsgId: string; message: string; name: string; coreScore: number; coreReasons: string[] };
export type QualifyFn = (messages: QualifyInput[]) => Promise<AiBatchOutcome[]>;

export type PickLeadsInput<T extends IngestItem> = {
  items: readonly T[];
  coreSettings: LeadCoreSettings;
  /** Keys of existing or deleted leads. */
  seen: ReadonlySet<string>;
  /** Active AI rejections (key → until), applied only when `qualify` is set. */
  aiRejects: Readonly<Record<string, string>>;
  /** Epoch ms; dated items older than this are dropped. */
  depthCutoff: number;
  /** null = AI off: every core candidate is judged by the core. */
  qualify: QualifyFn | null;
  /**
   * AI work cap for one run: beyond it items stay undecided (`deferred`), neither kept nor
   * rejected, so a caller that keeps its cursor meets them again next run. Unset = no cap.
   */
  maxJudged?: number;
};

export type PickedLead<T> = { item: T; core: LeadScoreResult; temperature: "hot" | "warm"; reason: string };

export type IngestFunnel = {
  fetched: number;
  core: number;
  fresh: number;
  aiRemembered: number;
  matched: number;
  aiUsed: boolean;
};

export type PickLeadsResult<T> = { kept: PickedLead<T>[]; rejectedIds: string[]; funnel: IngestFunnel; deferred: number };

type Candidate<T> = { item: T; core: LeadScoreResult };

function isTooOld(date: string | undefined, cutoff: number): boolean {
  if (!date) return false;
  const t = Date.parse(date);
  return Number.isFinite(t) && t < cutoff;
}

function coreCandidates<T extends IngestItem>(items: readonly T[], settings: LeadCoreSettings, cutoff: number): Candidate<T>[] {
  const out: Candidate<T>[] = [];
  for (const item of items) {
    if (!item.key || isTooOld(item.date, cutoff)) continue;
    const decision = decideScanLead(item.message, settings);
    if (decision.pass) out.push({ item, core: decision.core });
  }
  return out;
}

/** Drops seen keys and repeats inside the batch (first occurrence wins). */
function unseen<T extends IngestItem>(candidates: Candidate<T>[], seen: ReadonlySet<string>): Candidate<T>[] {
  const taken = new Set<string>();
  return candidates.filter(({ item }) => {
    if (seen.has(item.key) || taken.has(item.key)) return false;
    taken.add(item.key);
    return true;
  });
}

/** A throwing qualify is a failed run, not a verdict: null sends everyone to the core fallback. */
async function askAi<T extends IngestItem>(qualify: QualifyFn, candidates: Candidate<T>[]): Promise<AiBatchOutcome[] | null> {
  if (!candidates.length) return null;
  try {
    return await qualify(
      candidates.map(({ item, core }) => ({
        tgMsgId: item.key,
        message: item.message,
        name: item.name,
        coreScore: Number(core.score) || 0,
        coreReasons: Array.isArray(core.reasons) ? core.reasons : [],
      })),
    );
  } catch (e) {
    console.warn("[lead-ingest] qualify failed:", String((e as Error)?.message || e).slice(0, 200));
    return null;
  }
}

export async function pickLeads<T extends IngestItem>(input: PickLeadsInput<T>): Promise<PickLeadsResult<T>> {
  const core = coreCandidates(input.items, input.coreSettings, input.depthCutoff);
  const fresh = unseen(core, input.seen);
  const open = input.qualify ? fresh.filter(({ item }) => !input.aiRejects[item.key]) : fresh;
  const cap = input.qualify && input.maxJudged !== undefined ? Math.max(0, input.maxJudged) : open.length;
  const judged = open.slice(0, cap);
  const batches = input.qualify ? await askAi(input.qualify, judged) : null;
  const verdict = applyAiVerdicts(
    judged.map(({ item, core: c }) => ({ tgMsgId: item.key, core: c })),
    batches,
  );
  const byKey = new Map(judged.map((c) => [c.item.key, c]));
  const kept = verdict.kept.flatMap((k) => {
    const c = byKey.get(k.tgMsgId);
    return c ? [{ item: c.item, core: c.core, temperature: k.temperature, reason: k.reason }] : [];
  });
  return {
    kept,
    rejectedIds: verdict.rejectedIds,
    funnel: {
      fetched: input.items.length,
      core: core.length,
      fresh: fresh.length,
      aiRemembered: fresh.length - open.length,
      matched: kept.length,
      aiUsed: !!batches?.some((b) => b.ok),
    },
    deferred: open.length - judged.length,
  };
}
