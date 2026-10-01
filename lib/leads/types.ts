/** Lead core v2 shared types (docs/project/specs/lead-core-v2.md, Contracts). */

import type { z } from "zod";
import type { ChatPrompt } from "@/lib/ai-client";

export const MESSAGE_KINDS = ["group", "discussion", "comment"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type SourceKind = MessageKind | "dm";

export const DRAFT_KINDS = ["group_reply", "dm_first", "dm_continue"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** One message as returned by the worker `/scan-group` (normalized by `filter.ts::normalizeScanMessage`). */
export type ScanMessage = {
  tgMsgId: string;
  message: string;
  name: string;
  date: string;
  senderId: string;
  senderUsername: string;
  senderAccessHash: string;
  messageKind: MessageKind | "";
  peerId: string;
  replyToMsgId: string;
};

/**
 * Funnel counters, events per run (REQ-13). `skippedError` is the worker's count (`get_sender` failures),
 * `skippedErrorApp` the app's (empty `tgMsgId`); they are separate so the invariant stays checkable.
 */
export const FUNNEL_COUNTERS = [
  "fetched",
  "skippedNotUser",
  "skippedOldWorker",
  "skippedError",
  "returned",
  "skippedErrorApp",
  "old",
  "short",
  "duplicate",
  "stopword",
  "judged",
  "judgeSkipped",
  "judgeError",
  "rejected",
  "leads",
] as const;
export type FunnelCounter = (typeof FUNNEL_COUNTERS)[number];
export type FunnelCounts = Record<FunnelCounter, number>;

/** Steps the app decides on; each of them keeps ≤3 samples. */
export const SAMPLE_STEPS = [
  "skippedErrorApp",
  "old",
  "short",
  "duplicate",
  "stopword",
  "judgeSkipped",
  "judgeError",
  "rejected",
  "leads",
] as const;
export type SampleStep = (typeof SAMPLE_STEPS)[number];

export type FunnelSample = { text: string; term?: string; reason?: string };
export type FunnelSamples = Partial<Record<SampleStep, FunnelSample[]>>;

/** What one run (group scan or DM pass) adds to its `scan_day` row. */
export type ScanDelta = { counts: FunnelCounts; samples: FunnelSamples; run: string };

export type Verdict = { id: string; isLead: boolean; score: number; reason: string };

/** Why a message was not judged: no key / daily cap / earlier failure / per-scan batch limit / 90 s deadline / DM limits. */
export type JudgeSkipReason =
  | "no_ai_key"
  | "deadline"
  | "daily_cap"
  | "blocked"
  | "batch_limit"
  | "sender_limit"
  | "no_project";

/** Daily judge cap: reserve `count` messages; false = cap reached (REQ-10 `judgeSkipped`). */
export type JudgeGate = (count: number) => Promise<boolean>;

export type UnjudgedStep = "judgeSkipped" | "judgeError";

/**
 * Judge LLM: `JsonLlm` plus the number of messages / senders the call judges, so a retry can reserve
 * the daily cap for exactly those units. A plain `JsonLlm` (tests, eval script) is assignable.
 */
export type JudgeLlm = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, prompt: ChatPrompt, units: number) => Promise<T>;

