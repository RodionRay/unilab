/** Подсказки плюс/минус слов и обучение на горячих лидах. */

import { splitTerms } from "@/lib/lead-filter";

export const SUGGESTED_PLUS = [
  "остатки",
  "синхронизация",
  "МойСклад",
  "1С",
  "управление ценами",
  "ответы на отзывы",
  "автоматизация",
  "несколько кабинетов",
  "интеграция",
  "юнит-экономика",
  "себестоимость",
  "парсер",
  "ищу сервис",
  "кто пользуется",
  "нужна crm",
  "биддер",
  "реклама wb",
] as const;

export const SUGGESTED_MINUS = [
  "вакансия",
  "резюме",
  "куплю аккаунт",
  "продаю аккаунт",
  "схема",
  "серый",
  "арбитраж отзывов",
  "накрутка",
  "казино",
  "крипта",
  "взлом",
  "бесплатно навсегда",
  "раздача",
  "курсы инфобиз",
  "заработок без вложений",
  "матрица судьбы",
  "таро",
  "гадание",
  "астролог",
  "нумеролог",
  "эзотерика",
  "писать @",
] as const;

export function parseKeywordCsv(value: string): string[] {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mergeKeywords(current: string, add: string | string[]): string {
  const base = parseKeywordCsv(current);
  const set = new Set(base.map((s) => s.toLowerCase()));
  const incoming = Array.isArray(add) ? add : [add];
  for (const raw of incoming) {
    const t = String(raw || "").trim();
    if (!t || set.has(t.toLowerCase())) continue;
    set.add(t.toLowerCase());
    base.push(t);
  }
  return base.join(", ");
}

/** Новые слова в начало; обрезка с конца по лимиту символов (чтобы стоп-слова не терялись). */
export function mergeKeywordsPreferNew(
  current: string,
  add: string | string[],
  maxLen = 8000,
): string {
  const existing = parseKeywordCsv(current);
  const incoming = (Array.isArray(add) ? add : [add])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const set = new Set<string>();
  const out: string[] = [];
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (!t || set.has(k)) return;
    set.add(k);
    out.push(t);
  };
  for (const t of incoming) push(t);
  for (const t of existing) push(t);
  let joined = out.join(", ");
  if (joined.length <= maxLen) return joined;
  // срезаем старые с хвоста по терминам
  while (out.length > 1 && out.join(", ").length > maxLen) out.pop();
  joined = out.join(", ");
  return joined.length <= maxLen ? joined : joined.slice(0, maxLen);
}

export function unusedSuggestions(
  current: string,
  pool: readonly string[],
): string[] {
  const have = new Set(parseKeywordCsv(current).map((s) => s.toLowerCase()));
  return pool.filter((p) => !have.has(p.toLowerCase()));
}

/** Простые токены из сообщений для обучения (горячие → плюс, игнор → минус). */
export function extractTermsFromHotMessages(
  messages: string[],
  opts?: { max?: number; minCount?: number },
): string[] {
  const stop = new Set([
    "это",
    "как",
    "что",
    "для",
    "или",
    "если",
    "есть",
    "меня",
    "нужно",
    "можно",
    "кто",
    "подскажите",
    "пожалуйста",
    "привет",
    "всем",
    "сегодня",
    "просто",
    "только",
    "также",
    "чтобы",
    "будет",
    "уже",
    "очень",
    "который",
    "которая",
  ]);
  const minCount = opts?.minCount ?? 2;
  const counts = new Map<string, number>();
  for (const msg of messages) {
    const words = String(msg || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && w.length <= 32 && !stop.has(w));
    const uniq = new Set(words);
    for (const w of uniq) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts?.max ?? 12)
    .map(([w]) => w);
}

export function suggestFromProductText(text: string): {
  plus: string[];
  minus: string[];
} {
  const body = (text || "").toLowerCase();
  const plus = SUGGESTED_PLUS.filter(
    (p) => body.includes(p.toLowerCase()) || p.length <= 12,
  ).slice(0, 16);
  return { plus, minus: [...SUGGESTED_MINUS] };
}

export function appendLearnExamples(
  current: string,
  examples: string[],
): string {
  const existing = splitTerms(current);
  const set = new Set(existing);
  const next = [...existing];
  for (const ex of examples) {
    const t = ex.trim().slice(0, 120);
    if (!t || set.has(t.toLowerCase())) continue;
    set.add(t.toLowerCase());
    next.push(t);
  }
  return next.slice(0, 40).join(" | ");
}

/** Стоп-термины из одного «плохого» сообщения (не лид). */
export function extractStopTermsFromMessage(
  message: string,
  opts?: { max?: number; plusKeywords?: string },
): string[] {
  const plus = new Set(
    parseKeywordCsv(opts?.plusKeywords || "").map((s) => s.toLowerCase()),
  );
  const stop = new Set([
    "это",
    "как",
    "что",
    "для",
    "или",
    "если",
    "есть",
    "меня",
    "нужно",
    "можно",
    "кто",
    "подскажите",
    "пожалуйста",
    "привет",
    "всем",
    "сегодня",
    "просто",
    "только",
    "также",
    "чтобы",
    "будет",
    "уже",
    "очень",
    "который",
    "которая",
    "помогите",
    "помоги",
    "скажите",
    "нужен",
    "нужна",
    "нужны",
    "ищу",
    "ищем",
  ]);
  const words = String(message || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && w.length <= 28 && !stop.has(w));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const key = t.toLowerCase().trim();
    if (!key || key.length < 4 || seen.has(key) || plus.has(key) || stop.has(key))
      return;
    seen.add(key);
    out.push(t.trim());
  };
  for (let i = 0; i < words.length - 1; i++) {
    push(`${words[i]} ${words[i + 1]}`);
  }
  for (const w of words) push(w);
  return out.slice(0, opts?.max ?? 8);
}
