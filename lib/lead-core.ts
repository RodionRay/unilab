/**
 * Ядро поиска лидов: нормализация → hard reject → score → gate → температура.
 * Лид = автор ищет сервис/инструмент под продукт из настроек. Чат ≠ лид.
 */

import {
  WEAK_PLUS_TERMS,
  hasBuyerIntent,
  hasProductFit,
  hasSoftAsk,
  leadMessageFingerprint,
  looksLikeServiceAd,
  normalizeLeadMessage,
  parseLeadTemperature,
  splitTerms,
  strongPlusTerms,
  type LeadTemperature,
} from "@/lib/lead-filter";

export const LEAD_SCORE_HOT = 70;
export const LEAD_SCORE_WARM = 45;

export type LeadCoreSettings = {
  keywords?: string;
  minusKeywords?: string;
  avoidTopics?: string;
  leadCriteria?: string;
  hotSignals?: string;
  product?: string;
};

export type LeadScoreResult = {
  buyer: boolean;
  softAsk: boolean;
  fit: boolean;
  plusHits: string[];
  criteriaHits: string[];
  signalHits: string[];
  score: number;
  reasons: string[];
  rejectReason: string;
};

export type LeadCoreDecision = LeadScoreResult & {
  pass: boolean;
  temperature: LeadTemperature | null;
  summary: string;
  fingerprint: string;
  text: string;
};

const FIT_STOP = new Set([
  "если",
  "или",
  "для",
  "что",
  "как",
  "это",
  "есть",
  "нужно",
  "можно",
  "который",
  "которая",
  "также",
  "чтобы",
  "будет",
  "уже",
  "очень",
  "только",
  "просто",
  "сегодня",
  "человек",
  "люди",
  "когда",
  "после",
  "перед",
  "через",
  "между",
  "целевой",
  "лид",
  "явно",
  "ищут",
  "готов",
  "обсуждать",
]);

/** Нишевые термины fit из критериев и продукта AI-ассистента (без keywords/hotSignals). */
export function fitTermsFromSettings(settings: LeadCoreSettings): string[] {
  const set = new Set<string>();
  const out: string[] = [];
  const push = (t: string) => {
    const k = String(t || "")
      .toLowerCase()
      .trim();
    if (!k || k.length < 3 || FIT_STOP.has(k) || WEAK_PLUS_TERMS.has(k) || set.has(k))
      return;
    set.add(k);
    out.push(k);
  };

  // Фразы из критериев лида
  for (const t of splitTerms(String(settings.leadCriteria || "").replace(/\n/g, ","))) {
    if (t.length >= 4) push(t);
  }
  for (const w of String(settings.leadCriteria || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .split(/\s+/)) {
    if (w.length >= 5) push(w);
  }

  // Значимые слова из описания продукта
  for (const w of String(settings.product || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .split(/\s+/)) {
    if (w.length >= 5 && !FIT_STOP.has(w) && !WEAK_PLUS_TERMS.has(w)) push(w);
    if (out.length >= 50) break;
  }

  return out.slice(0, 50);
}

/** Есть ли содержательные настройки ассистента для fit. */
export function hasAssistantFitConfig(settings: LeadCoreSettings): boolean {
  return (
    strongPlusTerms(settings.keywords || "").length > 0 ||
    splitTerms(settings.hotSignals || "").some((t) => t.length >= 3) ||
    String(settings.leadCriteria || "").trim().length > 40 ||
    String(settings.product || "").trim().length > 40
  );
}

/** Ключи для worker: плюс + сигналы из настроек AI. */
export function workerKeywordsFromSettings(settings: LeadCoreSettings): string[] {
  const set = new Set<string>();
  const out: string[] = [];
  for (const t of [
    ...strongPlusTerms(settings.keywords || ""),
    ...splitTerms(settings.hotSignals || ""),
    ...fitTermsFromSettings(settings).slice(0, 20),
  ]) {
    const k = t.toLowerCase();
    if (!k || k.length < 3 || set.has(k) || WEAK_PLUS_TERMS.has(k)) continue;
    set.add(k);
    out.push(k);
  }
  return out;
}

export function normalizeCandidate(message: string): { text: string; body: string } {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  return { text, body: text.toLowerCase() };
}

export function hardReject(
  text: string,
  settings: LeadCoreSettings,
): string {
  const { body } = normalizeCandidate(text);
  if (body.length < 16) return "Слишком короткое сообщение";
  if (looksLikeServiceAd(text)) return "Реклама / спам / чужой оффер";
  const minus = splitTerms(
    [settings.minusKeywords || "", settings.avoidTopics || ""].join(", "),
  );
  const hit = minus.find((m) => m.length >= 3 && body.includes(m));
  if (hit) return `Стоп-слово: ${hit}`;
  return "";
}

export function scoreLead(text: string, settings: LeadCoreSettings): LeadScoreResult {
  const rejectReason = hardReject(text, settings);
  if (rejectReason) {
    return {
      buyer: false,
      softAsk: false,
      fit: false,
      plusHits: [],
      criteriaHits: [],
      signalHits: [],
      score: 0,
      reasons: [rejectReason],
      rejectReason,
    };
  }

  const { body } = normalizeCandidate(text);
  const buyer = hasBuyerIntent(text);
  const softAsk = hasSoftAsk(text);

  const plus = strongPlusTerms(settings.keywords || "");
  const plusHits = plus.filter((p) => body.includes(p));

  const signalHits = splitTerms(settings.hotSignals || "").filter(
    (t) =>
      t.length >= 3 &&
      body.includes(t) &&
      !WEAK_PLUS_TERMS.has(t) &&
      !plusHits.includes(t),
  );

  const criteriaTerms = fitTermsFromSettings(settings);
  const criteriaHits = criteriaTerms.filter(
    (t) => body.includes(t) && !plusHits.includes(t) && !signalHits.includes(t),
  );

  // Fit только из настроек AI-ассистента. Builtin Uniseller-fit — запасной, если настроек мало.
  const settingsFit =
    criteriaHits.length >= 1 || signalHits.length >= 1 || plusHits.length >= 1;
  const builtinFit =
    !hasAssistantFitConfig(settings) && hasProductFit(text);
  const fit = settingsFit || builtinFit;

  let score = 0;
  const reasons: string[] = [];

  if (buyer) {
    score += 40;
    reasons.push("Запрос сервиса / инструмента");
  }
  if (softAsk) {
    score += 20;
    reasons.push("Мягкий вопрос (подскажите / кто пользуется)");
  }
  if (plusHits.length) {
    score += Math.min(22, 8 * plusHits.length);
    reasons.push(`Плюс-слова AI: ${plusHits.slice(0, 3).join(", ")}`);
  }
  if (signalHits.length) {
    score += Math.min(18, 8 * signalHits.length);
    reasons.push(`Сигналы AI: ${signalHits.slice(0, 3).join(", ")}`);
  }
  if (criteriaHits.length) {
    score += Math.min(22, 7 * criteriaHits.length);
    reasons.push(`Критерии AI: ${criteriaHits.slice(0, 3).join(", ")}`);
  }
  if (builtinFit) {
    score += 15;
    reasons.push("Тема продукта (запасной fit)");
  }

  // Без buyer/soft — не поднимаем выше порога warm (чат ≠ лид)
  if (!buyer && !softAsk) {
    score = Math.min(score, LEAD_SCORE_WARM - 1);
    if (score > 0) reasons.push("Нет запроса услуги — только тема чата");
  }

  // Soft без привязки к настройкам ассистента — слабо
  if (softAsk && !buyer && !settingsFit && !builtinFit) {
    score = Math.min(score, 30);
    reasons.push("Вопрос без совпадения с настройками AI-ассистента");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    buyer,
    softAsk,
    fit,
    plusHits,
    criteriaHits,
    signalHits,
    score,
    reasons: reasons.length ? reasons : ["Нет сигналов по настройкам AI-ассистента"],
    rejectReason: "",
  };
}

export function passesLeadCore(score: LeadScoreResult): boolean {
  return !score.rejectReason && score.score >= LEAD_SCORE_WARM;
}

export function temperatureFromScore(score: LeadScoreResult): LeadTemperature | null {
  if (!passesLeadCore(score)) return null;
  if (score.score >= LEAD_SCORE_HOT && score.buyer && score.fit) return "hot";
  if (score.score >= LEAD_SCORE_HOT && score.buyer) return "hot";
  if (score.score >= LEAD_SCORE_WARM) return "warm";
  return null;
}

export function explainLeadDecision(
  message: string,
  settings: LeadCoreSettings,
  groupId = "",
  tgMsgId = "",
): LeadCoreDecision {
  const { text } = normalizeCandidate(message);
  const scored = scoreLead(text, settings);
  const temperature = temperatureFromScore(scored);
  const pass = !!temperature;
  const summary = pass
    ? `Пройдёт · ${temperature === "hot" ? "горячий" : "тёплый"} · ${scored.score}/100`
    : scored.rejectReason
      ? `Отказ · ${scored.rejectReason}`
      : `Отказ · score ${scored.score}/100 (нужно ≥${LEAD_SCORE_WARM})`;

  return {
    ...scored,
    pass,
    temperature,
    summary,
    fingerprint: leadMessageFingerprint(text, groupId, tgMsgId),
    text,
  };
}

/** Совместимость со старым API: проходит ли сообщение ядро. */
export function passesLeadCoreMessage(
  text: string,
  settings: LeadCoreSettings,
): boolean {
  return passesLeadCore(scoreLead(text, settings));
}

export function classifyWithLeadCore(
  text: string,
  settings: LeadCoreSettings,
): LeadTemperature | null {
  return temperatureFromScore(scoreLead(text, settings));
}

export function reasonFromCore(
  decision: LeadCoreDecision,
  aiReason = "",
): string {
  const parts = [
    decision.pass ? `ядро ${decision.score}` : `отсев ${decision.score}`,
    ...decision.reasons.slice(0, 3),
    aiReason ? `AI: ${aiReason}` : "",
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 500);
}

export { parseLeadTemperature, normalizeLeadMessage, leadMessageFingerprint };
