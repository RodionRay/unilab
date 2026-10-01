/**
 * AI-reject memory (REQ-6 `duplicate`, REQ-9): ids the judge rejected, valid while the project card they
 * were judged under (`sig`) is unchanged. Same stored shape and semantics as
 * `lib/processes/scan-flow.ts::activeAiRejects` / `rememberAiRejects`, so `group.aiRejected` stays readable.
 */

export type AiRejectMemory = { sig: string; until: Record<string, string> };
export const AI_REJECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_AI_REJECTS = 1000;

/** Unexpired rejections judged under `sig`; anything else (old card, garbage) is dropped. */
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
  active: Readonly<Record<string, string>>,
  ids: readonly string[],
  sig: string,
  now: number,
): AiRejectMemory {
  const until = new Date(now + AI_REJECT_TTL_MS).toISOString();
  const merged: Record<string, string> = { ...active };
  for (const id of ids) if (id) merged[id] = until;
  const entries = Object.entries(merged).sort((a, b) => a[1].localeCompare(b[1]));
  return { sig, until: Object.fromEntries(entries.slice(-MAX_AI_REJECTS)) };
}
