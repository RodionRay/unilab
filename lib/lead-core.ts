/**
 * @deprecated Compatibility surface for `components/product/lead-core-panel.tsx` only, which task T4
 * of lead core v2 deletes; delete this file together with it. The regex lead core is gone (REQ-7):
 * every lead is decided by the project judge in `lib/leads` (docs/leads-pipeline.md). Nothing here
 * scores or filters messages.
 */

import { HOT_SCORE } from "@/lib/leads/pipeline";

/** Judge thresholds shown by the legacy panel: hot from `HOT_SCORE`, warm from the default `minScore`. */
export const LEAD_SCORE_HOT = HOT_SCORE;
export const LEAD_SCORE_WARM = 50;

export type LeadCoreSettings = {
  keywords?: string;
  minusKeywords?: string;
  avoidTopics?: string;
  leadCriteria?: string;
  hotSignals?: string;
  product?: string;
};

export type LeadCoreDecision = {
  pass: boolean;
  summary: string;
  reasons: string[];
  buyer: boolean;
  softAsk: boolean;
  fit: boolean;
};

/** No local preview any more: the answer only tells the panel that the project judge decides. */
export const explainLeadDecision: (message: string, settings: LeadCoreSettings) => LeadCoreDecision = () => ({
  pass: false,
  summary: "Лиды отбирает AI-судья проекта — локальный предпросмотр удалён",
  reasons: [],
  buyer: false,
  softAsk: false,
  fit: false,
});
