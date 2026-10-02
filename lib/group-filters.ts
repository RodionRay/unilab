/**
 * Groups page filters (app/app/page.tsx): relevance band, minimum score, sort, search and the tab,
 * kept in the URL query. Pure so the list, the chip counts and the bulk assignment share one rule.
 * docs/join-pipeline.md §7, spec docs/project/specs/groups-filters-bulk-assign.md REQ-1..4.
 */

import type { GroupTab } from "@/lib/group-tabs";
import { RELEVANCE_AUTO_MIN, RELEVANCE_REVIEW_MIN, type RelevanceBand } from "@/lib/join-relevance";

export type GroupBandFilter = "all" | RelevanceBand;
export type GroupSort = "default" | "score_desc" | "score_asc";
export type GroupTabFilter = "all" | GroupTab;

export type GroupFilters = {
  q: string;
  band: GroupBandFilter;
  min: number;
  sort: GroupSort;
  tab: GroupTabFilter;
};

export const DEFAULT_GROUP_FILTERS: Readonly<GroupFilters> = Object.freeze({
  q: "",
  band: "all",
  min: 0,
  sort: "default",
  tab: "all",
});

/** Prefixed so they never clash with other views' params (`view`, …). */
export const GROUP_FILTER_PARAMS: Readonly<Record<keyof GroupFilters, string>> = Object.freeze({
  q: "g_q",
  band: "g_band",
  min: "g_min",
  sort: "g_sort",
  tab: "g_tab",
});

export const GROUP_SEARCH_MAX = 200;

const BANDS: readonly GroupBandFilter[] = ["all", "auto", "review", "skip"];
const SORTS: readonly GroupSort[] = ["default", "score_desc", "score_asc"];
const TABS: readonly GroupTabFilter[] = ["all", "need", "review", "skip", "joined", "pending", "error"];

export type GroupFilterData = {
  name?: unknown;
  username?: unknown;
  url?: unknown;
  joinRelevance?: unknown;
};

type ParamReader = { get(name: string): string | null };

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseMin(value: string | null): number {
  if (value === null || !/^\d{1,3}$/.test(value)) return DEFAULT_GROUP_FILTERS.min;
  const n = Number(value);
  return n <= 100 ? n : DEFAULT_GROUP_FILTERS.min;
}

/** Unknown or invalid values fall back to the defaults (REQ-4). */
export function parseGroupFilters(params: ParamReader): GroupFilters {
  const p = GROUP_FILTER_PARAMS;
  return {
    q: String(params.get(p.q) ?? "").slice(0, GROUP_SEARCH_MAX),
    band: oneOf(params.get(p.band), BANDS, DEFAULT_GROUP_FILTERS.band),
    min: parseMin(params.get(p.min)),
    sort: oneOf(params.get(p.sort), SORTS, DEFAULT_GROUP_FILTERS.sort),
    tab: oneOf(params.get(p.tab), TABS, DEFAULT_GROUP_FILTERS.tab),
  };
}

/** Writes non-default values into a copy of `base`, removes default ones, keeps foreign params. */
export function serializeGroupFilters(filters: GroupFilters, base: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  const set = (key: keyof GroupFilters, value: string, isDefault: boolean) => {
    if (isDefault) out.delete(GROUP_FILTER_PARAMS[key]);
    else out.set(GROUP_FILTER_PARAMS[key], value);
  };
  set("q", filters.q, !filters.q.trim());
  set("band", filters.band, filters.band === DEFAULT_GROUP_FILTERS.band);
  set("min", String(filters.min), filters.min === DEFAULT_GROUP_FILTERS.min);
  set("sort", filters.sort, filters.sort === DEFAULT_GROUP_FILTERS.sort);
  set("tab", filters.tab, filters.tab === DEFAULT_GROUP_FILTERS.tab);
  return out;
}

/** «Сбросить фильтры» shows while any of these differs from the default; the tab is navigation, not a filter. */
export function groupFiltersActive(filters: GroupFilters): boolean {
  return (
    !!filters.q.trim() ||
    filters.band !== DEFAULT_GROUP_FILTERS.band ||
    filters.min !== DEFAULT_GROUP_FILTERS.min ||
    filters.sort !== DEFAULT_GROUP_FILTERS.sort
  );
}

function relevanceOf(data: GroupFilterData): { score: number | null; band: RelevanceBand | null; reasons: string[] } {
  const rel = (data.joinRelevance ?? null) as { score?: unknown; band?: unknown; reasons?: unknown } | null;
  const raw = rel?.score;
  const score = raw !== undefined && raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const stored = rel?.band;
  const band: RelevanceBand | null =
    stored === "auto" || stored === "review" || stored === "skip"
      ? stored
      : score === null
        ? null
        : score >= RELEVANCE_AUTO_MIN
          ? "auto"
          : score >= RELEVANCE_REVIEW_MIN
            ? "review"
            : "skip";
  const reasons = Array.isArray(rel?.reasons) ? rel.reasons.map(String) : [];
  return { score, band, reasons };
}

/** Stored relevance score, or null for a group that was never scored. */
export function groupRelevanceScore(data: GroupFilterData): number | null {
  return relevanceOf(data).score;
}

function matchesSearch(data: GroupFilterData, reasons: readonly string[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [data.name, data.username, data.url, ...reasons].map((v) => String(v ?? "").toLowerCase());
  return haystack.some((text) => text.includes(needle));
}

/** Search + band + minimum score; the tab is applied separately (lib/group-tabs::groupInTab). */
export function groupMatchesFilters(data: GroupFilterData, filters: GroupFilters): boolean {
  const { score, band, reasons } = relevanceOf(data);
  if (filters.band !== "all" && band !== filters.band) return false;
  if (filters.min > 0 && (score === null || score < filters.min)) return false;
  return matchesSearch(data, reasons, filters.q);
}

/** Stable sort by relevance; unscored groups stay last in both directions. Returns a new array. */
export function sortGroups<T extends { data: GroupFilterData }>(rows: readonly T[], sort: GroupSort): T[] {
  if (sort === "default") return [...rows];
  const dir = sort === "score_desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, score: groupRelevanceScore(row.data) }))
    .sort((a, b) => {
      if (a.score === null || b.score === null) {
        if (a.score === b.score) return a.index - b.index;
        return a.score === null ? 1 : -1;
      }
      return (a.score - b.score) * dir || a.index - b.index;
    })
    .map((x) => x.row);
}

/**
 * Order of «Распределить по лимитам» targets: the visible order, its ties broken by score (higher
 * first, unscored last). `tieKey` = the visible sort value; null = no explicit order, all rows tie.
 */
export function byLimitTargetOrder<T extends { data: GroupFilterData }>(
  rows: readonly T[],
  tieKey: ((row: T) => unknown) | null,
): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const flush = () => {
    out.push(...sortGroups(run, "score_desc"));
    run = [];
  };
  for (const row of rows) {
    if (run.length && tieKey && tieKey(run[0]!) !== tieKey(row)) flush();
    run.push(row);
  }
  flush();
  return out;
}
