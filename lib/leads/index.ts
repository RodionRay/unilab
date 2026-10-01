/** Lead core v2 public surface (docs/project/specs/lead-core-v2.md). */

export * from "@/lib/leads/types";
export { filterMessages, findStopWord, normalizeScanMessage, MIN_TEXT_LENGTH, type FilterContext, type FilterResult } from "@/lib/leads/filter";
export { judgeMessages, judgeAnswerSchema, JUDGE_BATCH_SIZE, JUDGE_MAX_BATCHES, type JudgeResult, type JudgedMessage, type UnjudgedMessage } from "@/lib/leads/judge";
export {
  judgeDmSenders,
  groupDmSenders,
  normalizeDmMessage,
  DM_MAX_SENDERS,
  type DmMessage,
  type DmSender,
  type DmJudgeResult,
} from "@/lib/leads/dm-judge";
export {
  runGroupScan,
  runDmJudge,
  nextScanCursor,
  HOT_SCORE,
  type GroupScanDeps,
  type GroupScanResult,
  type DmJudgeDeps,
  type DmJudgeRunResult,
  type NewLead,
  type WorkerScanResult,
} from "@/lib/leads/pipeline";
export {
  upsertScanDay,
  readFunnel,
  mergeScanDay,
  aggregateFunnel,
  scanDayId,
  dayKey,
  emptyCounts,
  type ScanDayData,
  type FunnelView,
} from "@/lib/leads/funnel";
export {
  projectSchema,
  projectPatchSchema,
  applyProjectPatch,
  defaultProjectFromSettings,
  defaultProjectId,
  ensureDefaultProject,
  parseProjectData,
  projectIdOf,
  projectSignature,
  addFeedbackExample,
  uuidv5,
  MAX_PROJECTS_PER_OWNER,
  type ProjectData,
  type ProjectPatch,
  type ProjectRow,
} from "@/lib/leads/projects";
export { buildDraftPrompt, buildGroupJudgePrompt, buildDmJudgePrompt, DRAFT_THREAD_LIMIT, type DraftLead } from "@/lib/leads/prompt";
export { generateDraft } from "@/lib/leads/draft";
export { activeAiRejects, rememberAiRejects, type AiRejectMemory } from "@/lib/leads/reject-memory";
