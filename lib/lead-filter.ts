/**
 * Lead helpers shared by route/UI: dedupe fingerprint, text normalization, temperature labels and
 * group rating. The regex lead path is gone (lead core v2 REQ-7); leads are decided by lib/leads.
 */

export type LeadTemperature = "hot" | "warm" | "cold";

export const LEAD_TEMPERATURES = ["hot", "warm", "cold"] as const;

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
};

export function normalizeLeadMessage(text: string, max = 120): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max).toLowerCase();
}

/**
 * Dedupe key of a scanned message: `groupId:tgMsgId` when Telegram gave an id, so an edited
 * message keeps its key; text-based only for messages without an id (manual leads).
 */
export function leadMessageFingerprint(
  message: string,
  groupId = "",
  tgMsgId = "",
): string {
  if (tgMsgId) return `${groupId || ""}:${tgMsgId}`;
  return `${groupId || ""}::${normalizeLeadMessage(message)}`;
}

export function parseLeadTemperature(raw: unknown): LeadTemperature {
  const v = String(raw || "")
    .toLowerCase()
    .trim();
  if (v === "hot" || v === "горячий") return "hot";
  if (v === "warm" || v === "тёплый" || v === "теплый") return "warm";
  if (v === "cold" || v === "холодный") return "cold";
  return "cold";
}

/** Рейтинг 1–5 по доле hot+warm среди лидов группы. */
export function ratingFromTemperatures(counts: {
  hot: number;
  warm: number;
  cold: number;
}): number {
  const total = counts.hot + counts.warm + counts.cold;
  if (!total) return 0;
  const score = (counts.hot * 1 + counts.warm * 0.55) / total;
  return Math.max(1, Math.min(5, Math.round(1 + score * 4)));
}
