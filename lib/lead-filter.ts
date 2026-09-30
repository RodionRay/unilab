/** Правила отбора лидов из чатов. */

export type LeadFilterSettings = {
  keywords: string;
  minusKeywords: string;
};

export type LeadTemperature = "hot" | "warm" | "cold";

export const LEAD_TEMPERATURES = ["hot", "warm", "cold"] as const;

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
};

/**
 * Покупательский intent: человек ИЩЕТ услугу/сервис/совет «что взять»,
 * а не просто болтает про маркетплейс.
 * НЕ включать сюда темы продукта (автоматизация/интеграция) — иначе ловятся обычные реплики.
 */
const BUYER_INTENT_RE =
  /(?:^|[^\p{L}])(?:(?:ищу|ищем)\s+(?:сервис|подрядчик\w*|интегратор\w*|разработчик\w*|агентство|инструмент\w*|программ\w*|crm|решени\w*|платформ\w*)|нуж(?:ен|на|но|ны)\s+(?:сервис|подрядчик\w*|интегратор\w*|разработчик\w*|агентство|инструмент\w*|программ\w*|crm|решени\w*)|требуется\s+(?:сервис|подрядчик\w*|интегратор\w*)|подскаж(?:ите|и)\s+(?:сервис|crm|инструмент|платформ|чем\s+вести|как\s+вести)|посоветуйте\s+(?:сервис|crm|инструмент|платформ)|у\s+кого\s+(?:брать|заказывать)\s+(?:сервис|crm)|кто\s+(?:пользовался|пользуется)\s+\w+|как\s+(?:настроить|подключить|внедрить|автоматизировать)\s+(?:остат|синхрон|цен|отзыв|1с|мойсклад|кабинет)|готовы?\s+(?:купить|оплатить|внедрить)\s+(?:сервис|решени|подписк)|(?:пришлите|нужно|нужен|скиньте|запросите)\s+(?:кп|коммерческ)|на\s+демо|нужна?\s+crm|ищу\s+crm)/iu;

/** Мягкий вопрос — только вместе с product-fit / сильным плюсом. */
const SOFT_ASK_RE =
  /(?:^|[^\p{L}])(?:подскаж(?:ите|и)|посоветуйте|помогите\s+настроить|скажите\s+пожалуйста|кто\s+пользуется|кто\s+пользовался)/iu;

/** Анонсы/рассылки каналов — не лид. */
const BROADCAST_AD_RE =
  /(?:вам\s+срочное\s+сообщение|каталоге\s+решений|нельзя\s+пропустить|новинки[,]?\s+которые|гайд\s+для\s+продавцов|подписывайтесь|наш\s+сервис\s+помогает)/iu;

/** Тема продукта Uniseller: учёт/синхрон/цены/отзывы/кабинеты/1С. */
const PRODUCT_FIT_RE =
  /(?:остатк|синхрон|мой\s*склад|мойсклад|\b1с\b|управлен\w*\s+цен|автоответ\w*\s+на\s+отзыв|ответ\w*\s+на\s+отзыв|нескольк\w*\s+кабинет|едином?\s+окн|каталог\s+товар|заказы?\s+с\s+(?:вб|wb|озон)|интеграц\w*\s+(?:с\s+)?(?:1с|мойсклад|маркетплейс)|автоматиз\w*\s+(?:остат|заказ|цен|отзыв))/iu;

/** Маркетплейс-контекст (фон чата, сам по себе не лид). */
const MP_CONTEXT_RE =
  /(?:\bвб\b|\bwb\b|wildberries|вайлдберр|озон|\bozon\b|яндекс\s*маркет|megamarket|мегамаркет|фбс|фбо|fbs|fbo|пвз|селлер|маркетплейс|мойсклад|\b1с\b|юнит.?эконом|биддер|фулфилмент|fulfillment)/iu;

const SPAM_RE =
  /(?:нужн[ыа]\s*деньг|деньги\s+прямо\s+сейчас|займ|кредит\s+онлайн|пиши[,.]?\s*могу\s+помочь|накрутк|купл[юи]\s+аккаунт|продам\s+аккаунт|ваканси|резюме|ищу\s+работ)/iu;

const SERVICE_AD_RE =
  /(?:матриц[аыеу]\s+судьб|судьб\w*\s+матриц|таро|гадан\w*|астролог|нумеролог|эзотерик|руны\b|натальн\w*\s+карт|разбор\s+матриц|(?:писать|пишите|пиши|напишите)\s*@|tg\s*@|передано\s+через\s*@|есть\s+отзывы\s*[)）]|занимаюсь\s+(?:разбором|гадан|эзотери|таро)|принимаю\s+заказ|услуги\s+гадан)/iu;

/** Слишком общие плюс-слова — не считаем совпадением. */
export const WEAK_PLUS_TERMS = new Set([
  "отзывы",
  "цены",
  "цена",
  "товаров",
  "товар",
  "срок",
  "сроки",
  "работаю",
  "зовут",
  "селлер",
  "ozon",
  "wildberries",
  "wb",
  "вб",
  "маркетплейс",
  "маркетплейсы",
  "фбс",
  "фбо",
  "fbs",
  "fbo",
]);

export function splitTerms(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 120);
}

export function strongPlusTerms(raw: string): string[] {
  return splitTerms(raw).filter((t) => t.length >= 3 && !WEAK_PLUS_TERMS.has(t));
}

export function normalizeLeadMessage(text: string, max = 120): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max).toLowerCase();
}

export function leadMessageFingerprint(
  message: string,
  groupId = "",
  tgMsgId = "",
): string {
  return `${groupId || ""}:${tgMsgId || ""}:${normalizeLeadMessage(message)}`;
}

export function hasLeadIntent(text: string): boolean {
  return BUYER_INTENT_RE.test(text || "") || SOFT_ASK_RE.test(text || "");
}

/** Жёсткий покупательский запрос услуги/инструмента. */
export function hasBuyerIntent(text: string): boolean {
  return BUYER_INTENT_RE.test(text || "");
}

export function hasSoftAsk(text: string): boolean {
  return SOFT_ASK_RE.test(text || "");
}

export function hasProductFit(text: string): boolean {
  return PRODUCT_FIT_RE.test(text || "");
}

export function hasMarketplaceContext(text: string): boolean {
  return MP_CONTEXT_RE.test(text || "");
}

export function looksLikeServiceAd(text: string): boolean {
  return (
    SERVICE_AD_RE.test(text || "") ||
    SPAM_RE.test(text || "") ||
    BROADCAST_AD_RE.test(text || "")
  );
}

/**
 * Кандидат в лиды только если ищет сервис/инструмент.
 * Делегирует в ядро (lib/lead-core) для единого порога score.
 */
export function messageMatchesLeadFilter(
  text: string,
  settings: LeadFilterSettings & {
    avoidTopics?: string;
    leadCriteria?: string;
    hotSignals?: string;
    product?: string;
  },
): boolean {
  // lazy import avoided — re-export thin wrappers below after core exists
  const body = (text || "").toLowerCase();
  if (body.length < 16) return false;
  if (looksLikeServiceAd(text || "")) return false;
  const minus = splitTerms(settings.minusKeywords || "");
  if (minus.some((m) => m.length >= 3 && body.includes(m))) return false;

  const strong = strongPlusTerms(settings.keywords || "");
  const strongHits = strong.filter((p) => body.includes(p)).length;
  const buyer = hasBuyerIntent(text);
  const soft = hasSoftAsk(text);
  const fit = hasProductFit(text);
  const criteriaHits = splitTerms(settings.leadCriteria || "")
    .concat(splitTerms(settings.hotSignals || ""))
    .filter((t) => t.length >= 4 && body.includes(t) && !WEAK_PLUS_TERMS.has(t)).length;

  if (buyer && (fit || strongHits >= 1 || criteriaHits >= 1)) return true;
  if (buyer && /сервис|crm|инструмент|платформ|подряд|демо|внедр/i.test(text)) return true;
  if (soft && (fit || strongHits >= 1 || criteriaHits >= 1)) return true;
  return false;
}

/**
 * Без AI — через те же сигналы, что ядро (buyer/soft + fit).
 */
export function classifyLeadTemperature(
  text: string,
  settings: LeadFilterSettings & {
    leadCriteria?: string;
    hotSignals?: string;
    product?: string;
    avoidTopics?: string;
  },
): LeadTemperature | null {
  if (!messageMatchesLeadFilter(text, settings)) return null;

  const body = (text || "").toLowerCase();
  const strong = strongPlusTerms(settings.keywords || "");
  const hits = strong.filter((p) => body.includes(p)).length;
  const buyer = hasBuyerIntent(text);
  const fit = hasProductFit(text);
  const soft = hasSoftAsk(text);
  const criteriaHits = splitTerms(settings.leadCriteria || "")
    .concat(splitTerms(settings.hotSignals || ""))
    .filter((t) => t.length >= 4 && body.includes(t) && !WEAK_PLUS_TERMS.has(t)).length;

  if (buyer && (fit || hits >= 1 || criteriaHits >= 1)) return "hot";
  if (buyer) return "warm";
  if (soft && (fit || hits >= 1 || criteriaHits >= 1)) return "warm";
  return null;
}

export function parseLeadTemperature(raw: unknown): LeadTemperature {
  const v = String(raw || "")
    .toLowerCase()
    .trim();
  if (v === "hot" || v === "горячий") return "hot";
  if (v === "warm" || v === "тёплый" || v === "теплый") return "warm";
  if (v === "cold" || v === "холодный") return "cold";
  return "cold";
}

/** Рейтинг 1–5 по доле hot+warm среди лидов группы. */
export function ratingFromTemperatures(counts: {
  hot: number;
  warm: number;
  cold: number;
}): number {
  const total = counts.hot + counts.warm + counts.cold;
  if (!total) return 0;
  const score = (counts.hot * 1 + counts.warm * 0.55) / total;
  return Math.max(1, Math.min(5, Math.round(1 + score * 4)));
}

export function buildProjectBrief(settings: {
  name?: string;
  product?: string;
  projectUrl?: string;
  audience?: string;
  leadCriteria?: string;
  keywords?: string;
  minusKeywords?: string;
  pains?: string;
  valueProps?: string;
  avoidTopics?: string;
  hotSignals?: string;
  learnExamples?: string;
  tone?: string;
  cta?: string;
}): string {
  const parts = [
    settings.name ? `Проект: ${settings.name}` : "",
    settings.projectUrl ? `Сайт/ссылка: ${settings.projectUrl}` : "",
    settings.audience ? `Целевая аудитория: ${settings.audience}` : "",
    settings.product ? `О продукте и оффере (подробно):\n${settings.product}` : "",
    settings.pains ? `Боли клиента:\n${settings.pains}` : "",
    settings.valueProps ? `Ценность / результаты:\n${settings.valueProps}` : "",
    settings.leadCriteria
      ? `Критерии целевого лида:\n${settings.leadCriteria}`
      : "",
    settings.hotSignals
      ? `Сигналы горячего лида:\n${settings.hotSignals}`
      : "",
    settings.learnExamples
      ? `Примеры целевых формулировок (обучение):\n${settings.learnExamples}`
      : "",
    settings.keywords ? `Плюс-слова (искать): ${settings.keywords}` : "",
    settings.minusKeywords
      ? `Минус/стоп-слова (всегда исключать): ${settings.minusKeywords}`
      : "",
    settings.avoidTopics
      ? `Темы, которых избегать: ${settings.avoidTopics}`
      : "",
    settings.tone ? `Тон ответов: ${settings.tone}` : "",
    settings.cta ? `CTA: ${settings.cta}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}
