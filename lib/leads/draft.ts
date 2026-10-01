/** AI drafts (REQ-17): one text completion from the project card + last 12 thread entries; never sends. */

import type { TextLlm } from "@/lib/ai-client";
import { buildDraftPrompt, type DraftLead } from "@/lib/leads/prompt";
import type { ProjectData } from "@/lib/leads/projects";
import type { DraftKind } from "@/lib/leads/types";

export const DRAFT_MAX_LENGTH = 1500;
const WRAPPING_QUOTES_RE = /^[«"'“„]+|[»"'”]+$/g;

export async function generateDraft(
  kind: DraftKind,
  project: ProjectData,
  lead: DraftLead,
  llm: TextLlm,
): Promise<string> {
  const raw = await llm(buildDraftPrompt(kind, project, lead));
  const text = raw.trim().replace(WRAPPING_QUOTES_RE, "").trim().slice(0, DRAFT_MAX_LENGTH);
  if (!text) throw new Error("AI: empty draft");
  return text;
}
