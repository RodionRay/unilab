import { describe, expect, it } from "vitest";
import {
  AI_REJECT_TTL_MS,
  MAX_AI_REJECTS,
  MAX_LEAD_TOMBSTONES,
  activeAiRejects,
  addLeadTombstone,
  aiSettingsSignature,
  decideScanLead,
  evaluateScanGate,
  keepServerOwnedFields,
  rememberAiRejects,
} from "@/lib/processes/scan-flow";
import type { LeadCoreSettings } from "@/lib/lead-core";
import { withDayLimitCooldown, withSpamblockStatus } from "@/lib/telegram-accounts";

const settings: LeadCoreSettings = {
  keywords:
    "остатки, синхронизация, МойСклад, 1С, управление ценами, ответы на отзывы, автоматизация, несколько кабинетов, интеграция, ищу сервис, нужна crm, кто пользуется",
  minusKeywords:
    "вакансия, резюме, накрутка, матрица судьбы, таро, гадание, писать @, казино",
  avoidTopics: "болтовня селлеров без запроса сервиса",
  leadCriteria:
    "Явно ищет сервис для учёта остатков, синхронизации заказов, цен, отзывов, нескольких кабинетов, интеграции с 1С или МойСклад",
  hotSignals:
    "ищу сервис, нужен сервис, кто пользуется, интеграция 1с, мойсклад, синхронизация остатков",
  product:
    "Uniseller — платформа для WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинеты, 1С/МойСклад",
};

describe("скан · gate", () => {
  it("пропускает active", () => {
    expect(evaluateScanGate({ status: "active" })).toEqual({ ok: true });
  });

  it("блокирует отлёжку / spam / freeze / hard-dead", () => {
    // Отлёжка без вида лимита блокирует; дневной лимит вступлений скан не останавливает
    const cool = { status: "cooldown", cooldownUntil: new Date(Date.now() + 3600_000).toISOString() };
    expect(evaluateScanGate(cool).reason).toBe("cooldown");
    expect(evaluateScanGate(withDayLimitCooldown({ status: "active" }, "invite"))).toEqual({ ok: true });
    expect(evaluateScanGate(withSpamblockStatus({ status: "active" })).reason).toBe(
      "cooldown",
    );
    expect(evaluateScanGate({ status: "frozen" }).reason).toBe("cooldown");
    expect(evaluateScanGate({ status: "disconnected" }).reason).toBe("hard_dead");
    expect(evaluateScanGate(null).reason).toBe("missing");
  });
});

describe("скан · отбор лидов (lead-core)", () => {
  it("пропускает buyer+fit", () => {
    const d = decideScanLead(
      "Ищу сервис для синхронизации остатков WB и МойСклад, готовы на демо",
      settings,
    );
    expect(d.pass).toBe(true);
    expect(d.temperature).toBe("hot");
  });

  it("режет болтовню и минус-темы", () => {
    expect(
      decideScanLead(
        "В отчете по остаткам отражаются остатки на Электросталь, они не сгорели или что?",
        settings,
      ).pass,
    ).toBe(false);
    expect(
      decideScanLead(
        "Занимаюсь разбором матрицы судьбы, есть отзывы) писать @dearkis2",
        settings,
      ).pass,
    ).toBe(false);
    expect(
      decideScanLead("Селлерам отсрочка смертной казни на год 😅", settings).pass,
    ).toBe(false);
  });
});

describe("скан · память отказов AI (REQ-L11)", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");

  it("помнит отказ до истечения TTL и забывает после", () => {
    const mem = rememberAiRejects({}, ["10"], "sig", now);
    expect(activeAiRejects(mem, "sig", now + AI_REJECT_TTL_MS - 1)).toHaveProperty("10");
    expect(activeAiRejects(mem, "sig", now + AI_REJECT_TTL_MS + 1)).toEqual({});
  });

  it("сбрасывает память при смене настроек и держит потолок записей", () => {
    const mem = rememberAiRejects({}, ["10"], "sig", now);
    expect(activeAiRejects(mem, "other", now)).toEqual({});
    expect(aiSettingsSignature({ product: "a" })).not.toBe(aiSettingsSignature({ product: "b" }));
    const many = Array.from({ length: MAX_AI_REJECTS + 5 }, (_, i) => String(i));
    expect(Object.keys(rememberAiRejects({}, many, "sig", now).until)).toHaveLength(MAX_AI_REJECTS);
  });
});

describe("скан · tombstones и серверные поля (REQ-L6, REQ-L10)", () => {
  it("tombstone без дублей и с потолком", () => {
    expect(addLeadTombstone(["1"], "1")).toEqual(["1"]);
    expect(addLeadTombstone(undefined, "2")).toEqual(["2"]);
    const full = Array.from({ length: MAX_LEAD_TOMBSTONES }, (_, i) => String(i));
    const next = addLeadTombstone(full, "new");
    expect(next).toHaveLength(MAX_LEAD_TOMBSTONES);
    expect(next.at(-1)).toBe("new");
  });

  it("save лида берёт клиентские поля, но не серверные", () => {
    const merged = keepServerOwnedFields(
      "lead",
      { replies: [{ text: "a" }], coreScore: 70, status: "new" },
      { replies: [], status: "working", draft: "x" },
    );
    expect(merged).toEqual({ replies: [{ text: "a" }], coreScore: 70, status: "working", draft: "x" });
    expect(keepServerOwnedFields("account", { status: "a" }, { status: "b" })).toEqual({ status: "b" });
  });

  it("save лида не даёт клиенту задать серверное поле, которого нет в сохранённом лиде", () => {
    const merged = keepServerOwnedFields(
      "lead",
      { status: "new" },
      { status: "working", senderId: "666", peerId: "777", mailingTaskId: "x", accountId: "acc" },
    );
    expect(merged).toEqual({ status: "working" });
  });
});
