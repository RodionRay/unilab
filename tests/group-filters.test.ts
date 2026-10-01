import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_FILTERS,
  groupFiltersActive,
  groupMatchesFilters,
  parseGroupFilters,
  serializeGroupFilters,
  sortGroups,
  type GroupFilters,
} from "@/lib/group-filters";

const rel = (band: "auto" | "review" | "skip", score: number, reasons: string[] = []) => ({
  v: 3,
  sig: "x",
  score,
  band,
  reasons,
  members: 0,
  at: "",
});
const group = (extra: Record<string, unknown>) => ({
  name: "Селлеры WB",
  url: "https://t.me/wb_sellers_chat",
  membership: "none",
  status: "setup",
  ...extra,
});
const filters = (extra: Partial<GroupFilters>): GroupFilters => ({ ...DEFAULT_GROUP_FILTERS, ...extra });
const params = (q: string) => new URLSearchParams(q);

describe("group filters: relevance band and minimum score (REQ-1)", () => {
  it("band filter matches joinRelevance.band; «Все» keeps unscored groups", () => {
    const auto = group({ joinRelevance: rel("auto", 72) });
    const review = group({ joinRelevance: rel("review", 40) });
    const skip = group({ joinRelevance: rel("skip", 12) });
    const unscored = group({});

    expect([auto, review, skip, unscored].filter((g) => groupMatchesFilters(g, filters({ band: "auto" })))).toEqual([auto]);
    expect([auto, review, skip, unscored].filter((g) => groupMatchesFilters(g, filters({ band: "review" })))).toEqual([review]);
    expect([auto, review, skip, unscored].filter((g) => groupMatchesFilters(g, filters({ band: "skip" })))).toEqual([skip]);
    expect([auto, review, skip, unscored].filter((g) => groupMatchesFilters(g, filters({})))).toHaveLength(4);
  });

  it("a stored score without a band falls back to the thresholds", () => {
    const g = group({ joinRelevance: { score: 64, reasons: [] } });
    expect(groupMatchesFilters(g, filters({ band: "auto" }))).toBe(true);
    expect(groupMatchesFilters(g, filters({ band: "review" }))).toBe(false);
  });

  it("minimum score keeps scores ≥ min and drops unscored groups once min > 0", () => {
    expect(groupMatchesFilters(group({ joinRelevance: rel("review", 50) }), filters({ min: 50 }))).toBe(true);
    expect(groupMatchesFilters(group({ joinRelevance: rel("review", 49) }), filters({ min: 50 }))).toBe(false);
    expect(groupMatchesFilters(group({}), filters({ min: 1 }))).toBe(false);
    expect(groupMatchesFilters(group({}), filters({ min: 0 }))).toBe(true);
  });
});

describe("group filters: search (REQ-2)", () => {
  it("matches name, url and reasons case-insensitively", () => {
    const g = group({ name: "Озон Партнёры", url: "https://t.me/OzonPartners", joinRelevance: rel("auto", 70, ["ниша: маркетплейсы"]) });
    expect(groupMatchesFilters(g, filters({ q: "озон" }))).toBe(true);
    expect(groupMatchesFilters(g, filters({ q: "ozonpartners" }))).toBe(true);
    expect(groupMatchesFilters(g, filters({ q: "МАРКЕТПЛЕЙС" }))).toBe(true);
    expect(groupMatchesFilters(g, filters({ q: "  озон  " }))).toBe(true);
  });

  it("does not match other JSON fields (account ids, errors, status)", () => {
    const g = group({ accountId: "acc-findme", error: "findme", status: "findme", scanLog: [{ text: "findme" }] });
    expect(groupMatchesFilters(g, filters({ q: "findme" }))).toBe(false);
  });

  it("matches a separate username field when the record has one", () => {
    expect(groupMatchesFilters(group({ username: "seller_hub" }), filters({ q: "seller_hub" }))).toBe(true);
  });
});

describe("group sort (REQ-1)", () => {
  const rows = [
    { id: "a", data: group({ joinRelevance: rel("review", 40) }) },
    { id: "none", data: group({}) },
    { id: "b", data: group({ joinRelevance: rel("auto", 80) }) },
    { id: "c", data: group({ joinRelevance: rel("skip", 10) }) },
    { id: "d", data: group({ joinRelevance: rel("review", 40) }) },
  ];

  it("default keeps the given order", () => {
    expect(sortGroups(rows, "default").map((r) => r.id)).toEqual(["a", "none", "b", "c", "d"]);
  });

  it("relevance ↓ puts higher scores first, unscored last, ties stable", () => {
    expect(sortGroups(rows, "score_desc").map((r) => r.id)).toEqual(["b", "a", "d", "c", "none"]);
  });

  it("relevance ↑ puts lower scores first and still keeps unscored last", () => {
    expect(sortGroups(rows, "score_asc").map((r) => r.id)).toEqual(["c", "a", "d", "b", "none"]);
  });

  it("does not mutate the input", () => {
    const copy = rows.map((r) => r.id);
    sortGroups(rows, "score_desc");
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("group filters in the URL (REQ-4)", () => {
  it("parses prefixed params", () => {
    expect(parseGroupFilters(params("g_q=wb&g_band=review&g_min=35&g_sort=score_desc&g_tab=need"))).toEqual({
      q: "wb",
      band: "review",
      min: 35,
      sort: "score_desc",
      tab: "need",
    });
  });

  it("falls back to defaults on unknown or invalid values", () => {
    expect(parseGroupFilters(params("g_band=gold&g_min=abc&g_sort=random&g_tab=nope"))).toEqual(DEFAULT_GROUP_FILTERS);
    expect(parseGroupFilters(params("g_min=150")).min).toBe(0);
    expect(parseGroupFilters(params("g_min=-5")).min).toBe(0);
    expect(parseGroupFilters(params("g_min=12.5")).min).toBe(0);
    expect(parseGroupFilters(params(""))).toEqual(DEFAULT_GROUP_FILTERS);
  });

  it("caps a very long search value", () => {
    expect(parseGroupFilters(params(`g_q=${"x".repeat(500)}`)).q.length).toBe(200);
  });

  it("serializes only non-default values and keeps foreign params", () => {
    const out = serializeGroupFilters(filters({ q: "озон", band: "auto", min: 0 }), params("view=groups&g_min=40&g_sort=score_asc"));
    expect(out.get("view")).toBe("groups");
    expect(out.get("g_q")).toBe("озон");
    expect(out.get("g_band")).toBe("auto");
    expect(out.has("g_min")).toBe(false);
    expect(out.has("g_sort")).toBe(false);
    expect(out.has("g_tab")).toBe(false);
  });

  it("round-trips through the URL", () => {
    const f = filters({ q: "селлер", band: "skip", min: 20, sort: "score_asc", tab: "error" });
    expect(parseGroupFilters(serializeGroupFilters(f, params("")))).toEqual(f);
  });
});

describe("active filters (REQ-3)", () => {
  it("search, band, min and sort count as active; the tab does not", () => {
    expect(groupFiltersActive(DEFAULT_GROUP_FILTERS)).toBe(false);
    expect(groupFiltersActive(filters({ tab: "need" }))).toBe(false);
    expect(groupFiltersActive(filters({ q: " " }))).toBe(false);
    expect(groupFiltersActive(filters({ q: "wb" }))).toBe(true);
    expect(groupFiltersActive(filters({ band: "auto" }))).toBe(true);
    expect(groupFiltersActive(filters({ min: 10 }))).toBe(true);
    expect(groupFiltersActive(filters({ sort: "score_desc" }))).toBe(true);
  });
});
