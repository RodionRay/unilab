import { describe, expect, it } from "vitest";
import {
  catalogStats,
  isCatalogPlaceholderUrl,
  marketVerifiedCount,
  searchGroupCatalog,
  MARKET_SECTIONS,
} from "@/lib/group-catalog";

describe("каталог групп", () => {
  it("stats: verified и uniqueUrls > 0", () => {
    const s = catalogStats();
    expect(s.verified).toBeGreaterThan(100);
    expect(s.uniqueUrls).toBeGreaterThan(100);
    expect(s.total).toBeGreaterThanOrEqual(s.verified);
  });

  it("рынок all = все verified, mp уже", () => {
    expect(marketVerifiedCount("all")).toBe(catalogStats().verified);
    expect(marketVerifiedCount("mp")).toBeLessThan(marketVerifiedCount("all"));
    expect(MARKET_SECTIONS.some((m) => m.id === "all")).toBe(true);
  });

  it("searchGroupCatalog: all без ниш возвращает matched hits", () => {
    const all = searchGroupCatalog({ niches: [], mergeProject: false, onlyMatched: false });
    expect(all.length).toBeGreaterThan(100);
    const mp = searchGroupCatalog({
      niches: ["marketplaces"],
      mergeProject: false,
      onlyMatched: true,
    });
    expect(mp.length).toBeGreaterThan(0);
    expect(mp.length).toBeLessThan(all.length);
  });

  it("placeholder URL детектится, реальные t.me из каталога — нет", () => {
    expect(isCatalogPlaceholderUrl("https://t.me/wildberries_sllr")).toBe(false);
    expect(isCatalogPlaceholderUrl("https://t.me/mp_automation")).toBe(true);
    expect(isCatalogPlaceholderUrl("https://t.me/wb_sellers")).toBe(true);
  });
});
