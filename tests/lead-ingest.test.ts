import { describe, expect, it, vi } from "vitest";
import type { LeadCoreSettings } from "@/lib/lead-core";
import { pickLeads, type IngestItem, type QualifyFn } from "@/lib/processes/lead-ingest";

const coreSettings: LeadCoreSettings = {
  keywords: "остатки, синхронизация, МойСклад, несколько кабинетов",
  minusKeywords: "вакансия",
  avoidTopics: "",
  leadCriteria: "Ищет сервис для синхронизации остатков и заказов нескольких кабинетов маркетплейсов",
  hotSignals: "ищу сервис, кто пользуется, синхронизация остатков",
  product: "Платформа для селлеров WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов",
};

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const fresh = new Date(NOW - DAY).toISOString();

function lead(key: string, date = fresh): IngestItem {
  return { key, message: `Ищу сервис для синхронизации остатков WB и МойСклад, магазин номер ${key}`, name: "Иван", date };
}

function noise(key: string): IngestItem {
  return { key, message: "Всем привет, как погода?", name: "Пётр", date: fresh };
}

const okBatch = (ids: string[], picked: string[] = []): QualifyFn =>
  async () => [{ ids, ok: true, picked: picked.map((tgMsgId) => ({ tgMsgId, reason: "ищет", temperature: "hot" as const })) }];

function run(items: IngestItem[], over: Partial<Parameters<typeof pickLeads>[0]> = {}) {
  return pickLeads({
    items,
    coreSettings,
    seen: new Set(),
    aiRejects: {},
    depthCutoff: NOW - 7 * DAY,
    qualify: null,
    ...over,
  });
}

const keys = (r: Awaited<ReturnType<typeof pickLeads>>) => r.kept.map((k) => k.item.key);

describe("pickLeads · core prefilter", () => {
  it("keeps buyer messages and drops noise without AI", async () => {
    const r = await run([lead("1"), noise("2"), lead("3")]);

    expect(keys(r)).toEqual(["1", "3"]);
    expect(r.kept[0]!.temperature).toMatch(/^(hot|warm)$/);
    expect(r.kept[0]!.reason).not.toBe("");
    expect(r.kept[0]!.core.score).toBeGreaterThan(0);
    expect(r.rejectedIds).toEqual([]);
    expect(r.funnel).toEqual({ fetched: 3, core: 2, fresh: 2, aiRemembered: 0, matched: 2, aiUsed: false });
  });

  it("drops items without a key", async () => {
    const r = await run([lead("")]);

    expect(r.kept).toEqual([]);
    expect(r.funnel.core).toBe(0);
  });

  it("drops items older than the depth cutoff, keeps undated and unparseable dates", async () => {
    const old = lead("1", new Date(NOW - 8 * DAY).toISOString());
    const undated = { ...lead("2"), date: undefined };
    const garbage = lead("3", "not a date");

    const r = await run([old, undated, garbage]);

    expect(keys(r)).toEqual(["2", "3"]);
  });
});

describe("pickLeads · dedup", () => {
  it("skips keys already seen before AI is asked", async () => {
    const qualify = vi.fn(okBatch(["2"], ["2"]));

    const r = await run([lead("1"), lead("2")], { seen: new Set(["1"]), qualify });

    expect(qualify).toHaveBeenCalledTimes(1);
    expect(qualify.mock.calls[0]![0].map((m) => m.tgMsgId)).toEqual(["2"]);
    expect(keys(r)).toEqual(["2"]);
    expect(r.funnel).toMatchObject({ core: 2, fresh: 1, matched: 1 });
  });

  it("keeps only the first item of a repeated key", async () => {
    const r = await run([lead("1"), { ...lead("1"), name: "Дубль" }]);

    expect(r.kept.map((k) => k.item.name)).toEqual(["Иван"]);
  });
});

describe("pickLeads · AI qualification (REQ-L1, REQ-L11)", () => {
  it("passes key, text, author and core score to qualify", async () => {
    const qualify = vi.fn(okBatch(["1"], ["1"]));

    await run([lead("1")], { qualify });

    const sent = qualify.mock.calls[0]![0][0]!;
    expect(sent).toMatchObject({ tgMsgId: "1", name: "Иван", message: lead("1").message });
    expect(sent.coreScore).toBeGreaterThan(0);
    expect(Array.isArray(sent.coreReasons)).toBe(true);
  });

  it("an answered batch keeps picks and rejects the rest", async () => {
    const r = await run([lead("1"), lead("2")], { qualify: okBatch(["1", "2"], ["2"]) });

    expect(keys(r)).toEqual(["2"]);
    expect(r.rejectedIds).toEqual(["1"]);
    expect(r.funnel.aiUsed).toBe(true);
  });

  it("an answered batch with [] rejects every candidate", async () => {
    const r = await run([lead("1"), lead("2")], { qualify: okBatch(["1", "2"]) });

    expect(r.kept).toEqual([]);
    expect(r.rejectedIds).toEqual(["1", "2"]);
    expect(r.funnel).toMatchObject({ matched: 0, aiUsed: true });
  });

  it("a failed batch falls back to the core and remembers nothing", async () => {
    const qualify: QualifyFn = async () => [{ ids: ["1", "2"], ok: false, picked: [] }];

    const r = await run([lead("1"), lead("2")], { qualify });

    expect(keys(r)).toEqual(["1", "2"]);
    expect(r.rejectedIds).toEqual([]);
    expect(r.funnel.aiUsed).toBe(false);
  });

  it("a throwing qualify falls back to the core for all candidates", async () => {
    const qualify: QualifyFn = async () => {
      throw new Error("AI down");
    };

    const r = await run([lead("1"), lead("2")], { qualify });

    expect(keys(r)).toEqual(["1", "2"]);
    expect(r.rejectedIds).toEqual([]);
    expect(r.funnel.aiUsed).toBe(false);
  });

  it("does not resend remembered AI rejects and counts them", async () => {
    const qualify = vi.fn(okBatch(["2"], ["2"]));

    const r = await run([lead("1"), lead("2")], { aiRejects: { "1": "2026-10-08T00:00:00.000Z" }, qualify });

    expect(qualify.mock.calls[0]![0].map((m) => m.tgMsgId)).toEqual(["2"]);
    expect(keys(r)).toEqual(["2"]);
    expect(r.funnel).toMatchObject({ fresh: 2, aiRemembered: 1, matched: 1 });
  });

  it("ignores AI-reject memory when AI is off", async () => {
    const r = await run([lead("1")], { aiRejects: { "1": "2026-10-08T00:00:00.000Z" } });

    expect(keys(r)).toEqual(["1"]);
    expect(r.funnel.aiRemembered).toBe(0);
  });

  it("does not call qualify when nothing is left to judge", async () => {
    const qualify = vi.fn(okBatch([]));

    const r = await run([noise("1")], { qualify });

    expect(qualify).not.toHaveBeenCalled();
    expect(r.kept).toEqual([]);
  });
});
