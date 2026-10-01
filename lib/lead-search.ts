/** Lead list tabs in the CRM (app/app/page.tsx «Лиды» / «Переписки»). */

export type LeadTabData = {
  status?: string;
  temperature?: string;
  viewed?: boolean;
};

/** Tabs that are an inbox: an opened (viewed) lead leaves them and moves to «Просмотренные». */
const INBOX_TABS = new Set(["all", "new"]);
const TEMPERATURE_TABS = new Set(["hot", "warm", "cold"]);

/**
 * Whether a lead is listed under `tab`. The viewed/unviewed split applies only to «Все» / «Новые»;
 * temperature and status tabs («Горячие», «Тёплые», «В работе», «Архив») keep viewed leads.
 */
export function leadVisibleInTab(lead: LeadTabData, tab: string): boolean {
  if (tab === "viewed") return !!lead.viewed;
  if (INBOX_TABS.has(tab) && lead.viewed) return false;
  if (tab === "all") return true;
  if (TEMPERATURE_TABS.has(tab)) return (lead.temperature || "warm") === tab;
  return lead.status === tab;
}
