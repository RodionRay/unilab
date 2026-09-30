/**
 * Фикстуры ядра поиска лидов:
 * npx tsx scripts/check-lead-core.ts
 */
import {
  explainLeadDecision,
  LEAD_SCORE_WARM,
  type LeadCoreSettings,
} from "../lib/lead-core.ts";

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
    "Uniseller — платформа для WB/Ozon: остатки, заказы, цены, отзывы, несколько кабинетов, 1С/МойСклад",
};

type Case = {
  name: string;
  msg: string;
  expectPass: boolean;
  expectTemp?: "hot" | "warm" | null;
};

const cases: Case[] = [
  {
    name: "buyer+fit hot",
    msg: "Ищу сервис для синхронизации остатков WB и МойСклад, готовы на демо",
    expectPass: true,
    expectTemp: "hot",
  },
  {
    name: "soft+fit warm",
    msg: "Подскажите кто пользуется для нескольких кабинетов учётом остатков?",
    expectPass: true,
    expectTemp: "warm",
  },
  {
    name: "crm ask",
    msg: "Нужна CRM под маркетплейсы, кто что использует для остатков и заказов?",
    expectPass: true,
  },
  {
    name: "chat stock not lead",
    msg: "В отчете по остаткам отражаются остатки на Электросталь, они не сгорели или что?",
    expectPass: false,
  },
  {
    name: "seller joke",
    msg: "Селлерам отсрочка смертной казни на год 😅",
    expectPass: false,
  },
  {
    name: "destiny matrix ad",
    msg: "Занимаюсь разбором матрицы судьбы, есть отзывы) писать @dearkis2",
    expectPass: false,
  },
  {
    name: "ищу водителя",
    msg: "Ищу водителей на дальние рейсы, плачу от 50 тыс",
    expectPass: false,
  },
  {
    name: "spp complaint",
    msg: "СПП это зло! Цены меняют по 5 раз на дню, мы несем убытки",
    expectPass: false,
  },
  {
    name: "advice to others",
    msg: "Скачайте отчет из фбо - управление остатками, там будет лист скрыто из продажи",
    expectPass: false,
  },
  {
    name: "mpstats competitor ask",
    msg: "Кто пользуется MPstats подскажите какой тариф лучше брать?",
    expectPass: true,
    expectTemp: "warm",
  },
  {
    name: "vacancy",
    msg: "Вакансия: ищем менеджера маркетплейсов на полный день",
    expectPass: false,
  },
  {
    name: "1c integration ask",
    msg: "Подскажите сервис для интеграции 1С с Wildberries по остаткам",
    expectPass: true,
  },
  {
    name: "short noise",
    msg: "ок спасибо",
    expectPass: false,
  },
  {
    name: "broadcast ad",
    msg: "Вам срочное сообщение: в каталоге решений новинки которые нельзя пропустить",
    expectPass: false,
  },
  {
    name: "fbo chat only",
    msg: "У нас перестал продаваться товар с ФБО, отключили все фбс",
    expectPass: false,
  },
  {
    name: "weak plus alone",
    msg: "Цены на товары сегодня странные, срок поставки гуляет",
    expectPass: false,
  },
];

/** Другая ниша: лиды только по её настройкам AI, не по Uniseller. */
const dentalSettings: LeadCoreSettings = {
  keywords: "стоматология, запись пациентов, crm клиники, 1с медицина",
  minusKeywords: "вакансия, матрица судьбы, таро",
  leadCriteria: "Ищет CRM или запись пациентов для стоматологической клиники",
  hotSignals: "ищу crm, запись пациентов, стоматология",
  product: "DentalSoft — CRM для стоматологий: запись, карты пациентов, 1С",
};

const nicheCases: { name: string; msg: string; expectPass: boolean }[] = [
  {
    name: "dental: accept clinic CRM",
    msg: "Ищу CRM для стоматологии, нужна запись пациентов и карты",
    expectPass: true,
  },
  {
    name: "dental: reject marketplace stock",
    msg: "Ищу сервис для синхронизации остатков WB и МойСклад, готовы на демо",
    expectPass: false,
  },
];

let failed = 0;
for (const c of cases) {
  const d = explainLeadDecision(c.msg, settings);
  const okPass = d.pass === c.expectPass;
  const okTemp =
    c.expectTemp === undefined ||
    (c.expectTemp === null
      ? d.temperature === null
      : d.temperature === c.expectTemp);
  const ok = okPass && okTemp;
  if (!ok) failed++;
  console.log(
    `${ok ? "OK" : "FAIL"} [${c.name}] pass=${d.pass} temp=${d.temperature} score=${d.score} · ${d.summary}`,
  );
  if (!ok) console.log("  reasons:", d.reasons.join("; "));
}

for (const c of nicheCases) {
  const d = explainLeadDecision(c.msg, dentalSettings);
  const ok = d.pass === c.expectPass;
  if (!ok) failed++;
  console.log(
    `${ok ? "OK" : "FAIL"} [${c.name}] pass=${d.pass} score=${d.score} · ${d.summary}`,
  );
  if (!ok) console.log("  reasons:", d.reasons.join("; "));
}

const total = cases.length + nicheCases.length;
console.log(
  failed
    ? `\nFAILED ${failed}/${total} (warm threshold ${LEAD_SCORE_WARM})`
    : `\nAll ${total} fixtures passed`,
);
process.exit(failed ? 1 : 0);
