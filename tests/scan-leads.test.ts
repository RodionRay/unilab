import { describe, expect, it } from "vitest";
import { decideScanLead, evaluateScanGate } from "@/lib/processes/scan-flow";
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
    const cool = withDayLimitCooldown({ status: "active" }, "invite");
    expect(evaluateScanGate(cool).reason).toBe("cooldown");
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
