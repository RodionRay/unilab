import { describe, expect, it } from "vitest";
import {
  JOIN_RELEVANCE_VERSION,
  RELEVANCE_AUTO_MIN,
  RELEVANCE_REVIEW_MIN,
  buildRelevanceProfile,
  compareJoinPriority,
  isRelevanceStale,
  joinGateFor,
  membersFromText,
  productNiches,
  rescoreGroup,
  scoreGroupRelevance,
  seedRejoin,
} from "@/lib/join-relevance";

/** Settings shaped like a marketplace-seller SaaS (no real customer data). */
const SELLER_SETTINGS = {
  product:
    "Облачная платформа для селлеров Wildberries, Ozon и Яндекс Маркет: остатки, заказы, цены, отзывы. Синхронизация с 1С и МойСклад, автоматизация.",
  keywords: "остатки, синхронизация, мойсклад, несколько кабинетов, ищу сервис",
  hotSignals: "ищу сервис, кто пользуется, синхронизация остатков",
  leadCriteria: "Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов",
  audience: "Селлеры Wildberries, Ozon и Яндекс Маркет; интеграторы 1С и МойСклад",
  minusKeywords: "вакансия, казино",
  avoidTopics: "",
};

const profile = buildRelevanceProfile(SELLER_SETTINGS);
const score = (g: { name: string; url: string; source?: string }) => scoreGroupRelevance(g, profile);

describe("relevance score · bands", () => {
  it("seller chats are auto", () => {
    for (const g of [
      { name: "WB Official Chat", url: "https://t.me/wb_official_chat_test" },
      { name: "Ozon | Чат поставщиков", url: "https://t.me/ozon_suppliers_test" },
      { name: "Wildberries&Ozon | Чат Селлеров", url: "https://t.me/wildberriesozon_chats" },
    ]) {
      const r = score(g);
      expect(r.band, `${g.name} ${r.score} ${r.reasons.join(" · ")}`).toBe("auto");
      expect(r.score).toBeGreaterThanOrEqual(RELEVANCE_AUTO_MIN);
    }
  });

  it("off-niche marketing / SMM blogs are skipped with a reason", () => {
    for (const g of [
      { name: "DNative — блог Ткачука про SMM", url: "https://t.me/dnative", source: "tgstat-blogs" },
      { name: "Главред", url: "https://t.me/glvrd_test", source: "tgstat-blogs" },
      { name: "Боги маркетинга", url: "https://t.me/gods_marketing_test", source: "tgstat-blogs" },
      { name: "Куб маркетинга", url: "https://t.me/cube_marketing_test", source: "tgstat-blogs" },
    ]) {
      const r = score(g);
      expect(r.band, `${g.name} ${r.score}`).toBe("skip");
      expect(r.score).toBeLessThan(RELEVANCE_REVIEW_MIN);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("an on-topic broadcast channel never reaches auto (owner decides)", () => {
    const r = score({ name: "Селлеры Wildberries и Ozon", url: "https://t.me/sellers_news_test", source: "tgstat-blogs" });
    expect(r.band).toBe("review");
    expect(r.reasons.join(" ")).toMatch(/канал/);
  });

  it("«маркетинг» is not «маркет», «автоматизация» does not imply the «Авто» niche", () => {
    expect(productNiches("автоматизация продаж").has("auto")).toBe(false);
    const r = score({ name: "Маркетинг для всех", url: "https://t.me/marketing_all_test" });
    expect(r.band).toBe("skip");
  });

  it("uses a glued username (wbozsellers) and a short alias at its end (sellertestwb)", () => {
    expect(score({ name: "wbozsellers", url: "https://t.me/wbozsellers" }).score).toBeGreaterThanOrEqual(RELEVANCE_REVIEW_MIN);
    expect(score({ name: "@sellertestwb", url: "https://t.me/sellertestwb" }).band).not.toBe("skip");
  });

  it("a group that already produced leads is lifted even with a meaningless title", () => {
    const bare = score({ name: "marketguruclub_test", url: "https://t.me/marketguruclub_test" });
    const withLeads = scoreGroupRelevance({ name: "marketguruclub_test", url: "https://t.me/marketguruclub_test", leadsTotal: 11 }, profile);
    expect(bare.band).toBe("skip");
    expect(withLeads.score).toBeGreaterThanOrEqual(RELEVANCE_REVIEW_MIN);
    expect(withLeads.reasons[0]).toMatch(/давала лиды: 11/);
  });

  it("unconfigured settings never auto-join blind: every group waits for the owner", () => {
    const r = scoreGroupRelevance({ name: "Что угодно", url: "https://t.me/anything_test" }, buildRelevanceProfile({}));
    expect(r.band).toBe("review");
    expect(r.reasons[0]).toMatch(/не заданы/);
  });

  it("reads the subscriber count from the catalog description", () => {
    expect(membersFromText("Канал из TGStat «Маркетинг» (81 435 subscribers).")).toBe(81435);
    expect(membersFromText("без цифр")).toBe(0);
  });

  it("is deterministic and versioned by settings", () => {
    const g = { name: "Ozon Чат поставщиков", url: "https://t.me/ozon_chat_sup_test" };
    const a = score(g);
    expect(score(g).score).toBe(a.score);
    expect(a.v).toBe(JOIN_RELEVANCE_VERSION);
    expect(isRelevanceStale(a, profile)).toBe(false);
    const other = buildRelevanceProfile({ ...SELLER_SETTINGS, keywords: "другое" });
    expect(isRelevanceStale(a, other)).toBe(true);
    expect(isRelevanceStale(undefined, profile)).toBe(true);
  });
});

describe("relevance score · topical floor and business chats", () => {
  it("bumps the formula version so stored scores are recomputed", () => {
    expect(JOIN_RELEVANCE_VERSION).toBeGreaterThanOrEqual(3);
    expect(isRelevanceStale({ v: 2, sig: profile.sig, score: 24 }, profile)).toBe(true);
  });

  it("a topical channel (strong hit «wb») is never below review: «Дана Малкина WB»", () => {
    const r = score({ name: "Дана Малкина WB", url: "https://t.me/malkinawb", source: "tgstat" });
    expect(r.band, `${r.score} ${r.reasons.join(" · ")}`).toBe("review");
    expect(r.score).toBeGreaterThanOrEqual(RELEVANCE_REVIEW_MIN);
    expect(r.reasons.join(" ")).toMatch(/совпадения: wb/);
  });

  it("business chats are for the owner to decide, not skipped", () => {
    for (const g of [
      { name: "Предприниматели | Чат о бизнесе", url: "https://t.me/moscow_biz" },
      { name: "Бизнес-чат №1", url: "https://t.me/biznes_chat" },
    ]) {
      const r = score(g);
      expect(r.band, `${g.name} ${r.score} ${r.reasons.join(" · ")}`).toBe("review");
      expect(r.reasons.join(" ")).toMatch(/бизнес-чат: селлеры бывают — решите сами/);
      expect(r.reasons.join(" ")).not.toMatch(/не ваша ниша/);
    }
  });

  it("business broadcast channels and off-niche celebrity channels stay skipped", () => {
    expect(score({ name: "Мышление Миллионера", url: "https://t.me/millionaire_thinks", source: "tgstat" }).band).toBe("skip");
    expect(score({ name: "Ольга Звезда", url: "https://t.me/celebrity_star_test", source: "tgstat-blogs" }).band).toBe("skip");
  });
});

describe("join gate", () => {
  const rel = (band: "auto" | "review" | "skip", s: number) => ({ v: 1, sig: "x", score: s, band, reasons: ["r"], members: 0, at: "" });

  it("joined groups are always allowed and untouched by rescoring", () => {
    const g = { name: "Блог", url: "https://t.me/x_blog_test", membership: "joined", joinRelevance: rel("skip", 0) };
    expect(joinGateFor(g).allow).toBe(true);
    expect(joinGateFor(g).state).toBe("joined");
    expect(rescoreGroup(g, profile, { force: true })).toBeNull();
  });

  it("auto band joins; review and skip are parked with a reason; nothing is dropped", () => {
    expect(joinGateFor({ joinRelevance: rel("auto", 80) })).toMatchObject({ allow: true, state: "auto" });
    expect(joinGateFor({ joinRelevance: rel("review", 45) })).toMatchObject({ allow: false, state: "review", reason: "r" });
    expect(joinGateFor({ joinRelevance: rel("skip", 10) })).toMatchObject({ allow: false, state: "skip", label: "Не вступать" });
  });

  it("owner decisions beat the score; a dead link is never auto-joined", () => {
    expect(joinGateFor({ joinDecision: "approved", joinRelevance: rel("skip", 5) }).allow).toBe(true);
    expect(joinGateFor({ joinDecision: "skipped", joinRelevance: rel("auto", 95) }).allow).toBe(false);
    expect(joinGateFor({ joinDead: true, joinRelevance: rel("auto", 95) }).state).toBe("dead");
  });

  it("rejoin (membership reset by an account swap) passes, but a dead link and «skipped» still win", () => {
    expect(joinGateFor({ joinRejoin: true, joinRelevance: rel("skip", 0) })).toMatchObject({ allow: true, state: "joined" });
    expect(joinGateFor({ joinRejoin: true, joinDead: true }).state).toBe("dead");
    expect(joinGateFor({ joinRejoin: true, joinDecision: "skipped" }).state).toBe("skipped");
    expect(seedRejoin({ joinedAccountId: "a1", membership: "none" })).toMatchObject({ joinRejoin: true });
    const never = { membership: "none" };
    expect(seedRejoin(never)).toBe(never);
  });

  it("an unscored group is parked for review, not joined blind", () => {
    expect(joinGateFor({ name: "x" })).toMatchObject({ allow: false, state: "review" });
  });

  it("rescoring clears the queue state of parked groups only", () => {
    const off = { name: "Главред", url: "https://t.me/glvrd_test", source: "tgstat-blogs", joinState: "queued" };
    expect(rescoreGroup(off, profile)?.clearQueue).toBe(true);
    const on = { name: "Ozon | Чат поставщиков", url: "https://t.me/ozon_suppliers_test", joinState: "queued" };
    expect(rescoreGroup(on, profile)?.clearQueue).toBe(false);
    const fresh = { ...on, joinRelevance: rescoreGroup(on, profile)!.joinRelevance };
    expect(rescoreGroup(fresh, profile)).toBeNull();
    expect(rescoreGroup(fresh, profile, { force: true })).not.toBeNull();
  });

  it("queue order: approved first, then score, then audience size", () => {
    const list = [
      { name: "b", joinRelevance: { ...rel("auto", 70), members: 10 } },
      { name: "a", joinRelevance: { ...rel("auto", 90), members: 10 } },
      { name: "c", joinRelevance: { ...rel("auto", 70), members: 5000 } },
      { name: "d", joinDecision: "approved", joinRelevance: rel("skip", 5) },
    ];
    expect([...list].sort(compareJoinPriority).map((g) => g.name)).toEqual(["d", "a", "c", "b"]);
  });
});
