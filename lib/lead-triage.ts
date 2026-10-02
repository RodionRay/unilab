/**
 * Manual lead triage for the «Лиды» page (docs/project/specs/manual-lead-triage.md).
 * The triage state is the stored `status` field: opening a lead never moves it, only these actions do.
 * `viewed` is a read marker and is ignored here; «Переписки» keeps its read/unread folders (lib/lead-search.ts).
 */

export type LeadTriage = "new" | "lead" | "rejected";
export type LeadStatus = "new" | "working" | "archived";
export type LeadTriageTab = LeadTriage | "all";
export type LeadTemperatureFilter = "all" | "hot" | "warm" | "cold";

export const LEAD_TRIAGES: readonly LeadTriage[] = ["new", "lead", "rejected"];
export const LEAD_TRIAGE_TABS: readonly LeadTriageTab[] = ["new", "lead", "rejected", "all"];
/** Bulk request cap for `set_lead_triage` (one D1 statement per lead). */
export const MAX_TRIAGE_IDS = 500;

export const LEAD_TRIAGE_STATUS: Readonly<Record<LeadTriage, LeadStatus>> = {
  new: "new",
  lead: "working",
  rejected: "archived",
};

export const LEAD_TRIAGE_TAB_LABELS: Readonly<Record<LeadTriageTab, string>> = {
  new: "Новые",
  lead: "Лиды",
  rejected: "Отклонённые",
  all: "Все",
};

/** Button label of the action that moves a lead INTO the triage state. */
export const LEAD_TRIAGE_ACTION_LABELS: Readonly<Record<LeadTriage, string>> = {
  new: "Вернуть в новые",
  lead: "В лиды",
  rejected: "Не подходит",
};

export type LeadTriageData = { status?: unknown; temperature?: unknown; viewed?: unknown; needsManager?: unknown };

export function leadTriage(lead: LeadTriageData): LeadTriage {
  if (lead.status === "working") return "lead";
  if (lead.status === "archived") return "rejected";
  return "new";
}

/** Unread = never opened, or the client wrote after the last open. */
export function leadUnread(lead: LeadTriageData): boolean {
  return !lead.viewed || !!lead.needsManager;
}

export function leadInTriageTab(lead: LeadTriageData, tab: LeadTriageTab, temperature: LeadTemperatureFilter = "all"): boolean {
  if (tab !== "all" && leadTriage(lead) !== tab) return false;
  if (temperature === "all") return true;
  return (String(lead.temperature || "") || "warm") === temperature;
}

export function triageCounts(leads: readonly LeadTriageData[]): Record<LeadTriageTab, number> {
  const counts: Record<LeadTriageTab, number> = { new: 0, lead: 0, rejected: 0, all: leads.length };
  for (const lead of leads) counts[leadTriage(lead)] += 1;
  return counts;
}

/** The actions offered for a lead: every triage state except the current one, in a stable order. */
export function triageActionsFor(current: LeadTriage): LeadTriage[] {
  const order: LeadTriage[] = ["lead", "rejected", "new"];
  return order.filter((t) => t !== current);
}

/**
 * Maps a `goLeads({filter})` value (overview links, older callers) to tab + temperature.
 * Legacy values: `viewed` and status names from before triage; temperatures open «Новые».
 */
export function leadsLinkTarget(filter: string | undefined): { tab: LeadTriageTab; temperature: LeadTemperatureFilter } {
  const f = String(filter || "");
  if (f === "hot" || f === "warm" || f === "cold") return { tab: "new", temperature: f };
  if ((LEAD_TRIAGE_TABS as readonly string[]).includes(f)) return { tab: f as LeadTriageTab, temperature: "all" };
  if (f === "working") return { tab: "lead", temperature: "all" };
  if (f === "archived") return { tab: "rejected", temperature: "all" };
  if (f === "viewed") return { tab: "new", temperature: "all" };
  return { tab: "new", temperature: "all" };
}

export function isLeadTriage(v: unknown): v is LeadTriage {
  return typeof v === "string" && (LEAD_TRIAGES as readonly string[]).includes(v);
}
