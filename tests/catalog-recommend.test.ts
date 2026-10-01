import { describe, expect, it } from "vitest";
import {
  buildRecommendedView,
  bulkJoinConfirmText,
  catalogRowMeta,
  chatsLabel,
  nicheFallbackGate,
  projectCatalogCandidates,
  subscribersLabel,
  type RecommendGate,
} from "@/lib/catalog-recommend";
import type { CatalogGroup } from "@/lib/group-catalog";

const cat = (id: string, url: string, niches: CatalogGroup["niches"], description = "Чат селлеров."): CatalogGroup => ({
  id,
  name: `Чат ${id}`,
  url,
  verified: !!url,
  niches,
  description,
  audience: "",
  searchHint: url,
});

const rec = (id: string, data: Record<string, unknown>) => ({ id, data: { name: `Группа ${id}`, ...data } });

const gateFrom = (map: Record<string, RecommendGate>) => (data: Record<string, unknown>): RecommendGate =>
  map[String(data.url)] ?? { state: "review" };

describe("buildRecommendedView", () => {
  it("puts joined, pending and joinedAt groups only into «Вступили»", () => {
    const view = buildRecommendedView({
      groups: [
        rec("a", { url: "https://t.me/aaaaa1", membership: "joined", leadsTotal: 4 }),
        rec("b", { url: "https://t.me/bbbbb1", membership: "pending" }),
        rec("c", { url: "https://t.me/ccccc1", joinedAt: "2026-09-30T10:00:00Z" }),
      ],
      catalog: [],
      gateOf: () => ({ state: "auto" }),
    });
    expect(view.recommended).toEqual([]);
    expect(view.joined.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(view.joined.find((r) => r.id === "b")?.pending).toBe(true);
  });

  it("recommends only auto and owner-approved groups; hides review/skip/dead and counts them", () => {
    const view = buildRecommendedView({
      groups: [
        rec("auto", { url: "https://t.me/auto_chat" }),
        rec("appr", { url: "https://t.me/appr_chat" }),
        rec("rev", { url: "https://t.me/rev_chat" }),
        rec("skip", { url: "https://t.me/skip_chat" }),
        rec("dead", { url: "https://t.me/dead_chat" }),
      ],
      catalog: [],
      gateOf: gateFrom({
        "https://t.me/auto_chat": { state: "auto", score: 70 },
        "https://t.me/appr_chat": { state: "approved", score: 40 },
        "https://t.me/skip_chat": { state: "skip" },
        "https://t.me/dead_chat": { state: "dead" },
      }),
    });
    expect(view.recommended.map((r) => [r.id, r.status])).toEqual([
      ["auto", "join"],
      ["appr", "queued"],
    ]);
    expect(view.hiddenCount).toBe(3);
  });

  it("shows active join states in words and keeps them after actionable rows", () => {
    const view = buildRecommendedView({
      groups: [
        rec("q", { url: "https://t.me/queued_chat", joinState: "queued" }),
        rec("j", { url: "https://t.me/joining_chat", joinState: "joining" }),
        rec("n", { url: "https://t.me/new_chat" }),
      ],
      catalog: [],
      gateOf: () => ({ state: "auto" }),
    });
    expect(view.recommended.map((r) => [r.id, r.status])).toEqual([
      ["n", "join"],
      ["q", "queued"],
      ["j", "joining"],
    ]);
  });

  it("adds catalog chats that are not in the workspace yet, deduped by Telegram entity", () => {
    const view = buildRecommendedView({
      groups: [rec("w", { url: "https://t.me/Wb_Sellers" })],
      catalog: [
        cat("dup", "https://t.me/wb_sellers", ["marketplaces"]),
        cat("new", "https://t.me/ozon_people", ["marketplaces"]),
        cat("new-again", "t.me/ozon_people/12", ["marketplaces"]),
        cat("nolink", "", ["marketplaces"]),
      ],
      gateOf: () => ({ state: "auto", score: 61 }),
    });
    expect(view.recommended.map((r) => [r.source, r.id])).toEqual([
      ["workspace", "w"],
      ["catalog", "new"],
    ]);
  });

  it("sorts workspace rows by score, then catalog rows", () => {
    const view = buildRecommendedView({
      groups: [rec("low", { url: "https://t.me/low_chat" }), rec("high", { url: "https://t.me/high_chat" })],
      catalog: [cat("c1", "https://t.me/catalog_one", ["marketplaces"])],
      gateOf: gateFrom({
        "https://t.me/low_chat": { state: "auto", score: 61 },
        "https://t.me/high_chat": { state: "auto", score: 90 },
      }),
    });
    expect(view.recommended.map((r) => r.id)).toEqual(["high", "low", "c1"]);
  });

  it("filters both lists by query on name and handle without changing hiddenCount", () => {
    const view = buildRecommendedView({
      groups: [
        rec("x", { name: "Ozon продавцы", url: "https://t.me/ozon_sell" }),
        rec("y", { name: "Логистика", url: "https://t.me/logist_ru", membership: "joined" }),
        rec("z", { url: "https://t.me/hidden_one" }),
      ],
      catalog: [],
      gateOf: gateFrom({
        "https://t.me/ozon_sell": { state: "auto" },
        "https://t.me/hidden_one": { state: "skip" },
      }),
      query: "LOGIST",
    });
    expect(view.recommended).toEqual([]);
    expect(view.joined.map((r) => r.id)).toEqual(["y"]);
    expect(view.hiddenCount).toBe(1);
  });

  it("orders catalog chats by project fit and explains them with the matched niches", () => {
    const candidates = [
      cat("blog", "https://t.me/big_blog", ["blogs", "marketing", "business"]),
      cat("wb", "https://t.me/wb_people", ["marketplaces", "wildberries", "analytics"]),
    ];
    const view = buildRecommendedView({
      groups: [],
      catalog: candidates,
      gateOf: nicheFallbackGate(candidates, ["wildberries", "marketplaces", "business"]),
    });
    expect(view.recommended.map((r) => [r.id, r.reason])).toEqual([
      ["wb", "Маркетплейсы, Wildberries"],
      ["blog", "Бизнес"],
    ]);
  });

  it("reads handle and subscribers for rows", () => {
    const view = buildRecommendedView({
      groups: [],
      catalog: [cat("t", "https://t.me/BigChannel", ["blogs"], "Канал из TGStat «Блоги» (303 911 subscribers).")],
      gateOf: () => ({ state: "auto" }),
    });
    expect(view.recommended[0]).toMatchObject({ handle: "@BigChannel", subscribers: 303911 });
  });
});

describe("nicheFallbackGate", () => {
  const candidates = [cat("wb", "https://t.me/wb_sellers", ["marketplaces", "wildberries"])];
  const gate = nicheFallbackGate(candidates, ["wildberries"]);

  it("recommends a workspace group whose chat is a project-niche catalog chat, with the niche as reason", () => {
    expect(gate({ url: "t.me/WB_SELLERS" })).toEqual({ state: "auto", reason: "Wildberries", score: 1 });
  });

  it("does not recommend other groups", () => {
    expect(gate({ url: "https://t.me/random_chat" }).state).toBe("skip");
  });

  it("respects an owner skip and stored relevance when present", () => {
    expect(gate({ url: "https://t.me/wb_sellers", joinDecision: "skipped" }).state).toBe("skipped");
    expect(gate({ url: "https://t.me/random_chat", joinDecision: "approved" }).state).toBe("approved");
    expect(gate({ url: "https://t.me/random_chat", joinRelevance: { band: "auto", score: 72 } })).toMatchObject({
      state: "auto",
      score: 72,
    });
  });
});

describe("projectCatalogCandidates", () => {
  it("returns only joinable catalog chats of the project's niches, one per chat", () => {
    const { niches, groups } = projectCatalogCandidates(["Продаём сервис аналитики для селлеров Wildberries"]);
    expect(niches).toContain("wildberries");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.verified && g.url && g.niches.some((n) => niches.includes(n)))).toBe(true);
    const keys = groups.map((g) => g.url.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns nothing when the project text names no niche", () => {
    expect(projectCatalogCandidates(["", undefined]).groups).toEqual([]);
  });
});

describe("copy helpers", () => {
  it("pluralises counts in Russian with grouping", () => {
    expect(chatsLabel(1)).toBe("1 чат");
    expect(chatsLabel(3)).toBe("3 чата");
    expect(chatsLabel(11)).toBe("11 чатов");
    expect(subscribersLabel(303911)).toBe("303 911 подписчиков");
  });

  it("parses TGStat stamps and keeps human descriptions", () => {
    expect(catalogRowMeta({ url: "", description: "Чат селлеров WB." })).toEqual({
      handle: null,
      subscribers: null,
      blurb: "Чат селлеров WB.",
    });
  });

  it("names count and account in the bulk confirm", () => {
    const c = bulkJoinConfirmText({ names: ["A", "B", "C", "D"], accountName: "Тест" });
    expect(c.title).toBe("Вступить в 4 чата с аккаунта «Тест»?");
    expect(c.names).toBe("«A», «B», «C» и ещё 1.");
    expect(c.action).toBe("Вступить в 4 чата");
  });
});
