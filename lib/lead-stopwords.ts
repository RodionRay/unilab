/**
 * Guards the lead stop-lists (minusKeywords / avoidTopics) against auto-learning pollution.
 *
 * Auto-learning (the removed train_from_ignored / reject_lead_stopwords, LLM minus in rebuild_product) used to append the
 * product's own vocabulary ("остатков", "озон", "селлер", "нал", "бот" …) to the stop-lists, and
 * every scan then dropped exactly the messages we look for. A minus candidate is rejected here when
 * it is short, generic, marketplace context, or overlaps the positive settings of the assistant.
 */

import {
  MAX_MINUS_TERMS,
  MAX_MINUS_TERM_LENGTH,
  WEAK_PLUS_TERMS,
  normalizeYo,
  splitTerms,
} from "@/lib/lead-filter";

export type StopListSettings = {
  keywords?: string;
  hotSignals?: string;
  learnExamples?: string;
  product?: string;
  leadCriteria?: string;
  minusKeywords?: string;
  avoidTopics?: string;
};

export type CleanedStopLists = {
  minusKeywords: string;
  avoidTopics: string;
  removed: string[];
};

const MIN_CANDIDATE_LENGTH = 4;
const MIN_CONTENT_WORD_LENGTH = 3;
const STEM_LENGTH = 5;
const MIN_PROTECTED_TERM_LENGTH = 4;
const MIN_PROTECTED_WORD_LENGTH = 4;
const MIN_DESCRIPTION_WORD_LENGTH = 5;

/**
 * Ask / address / question / function words. A stop-term made only of them ("кто знает",
 * "нужна помощь", "ребят", "кто-нибудь") hits every real request, so it is never a stop signal.
 */
const GENERIC_WORDS = new Set([
  // ask
  "помогите", "помоги", "помощь", "подскажите", "подскажи", "посоветуйте", "посоветуй",
  "нужен", "нужна", "нужно", "нужны", "надо", "ищу", "ищем", "ищет", "скажите", "пожалуйста",
  "спасибо", "вопрос", "может", "можно", "знает", "знаете", "делает", "делаете", "разбирается",
  "пользуется", "пользовался", "пользуетесь", "работает", "есть",
  // address / greeting
  "здравствуйте", "привет", "всем", "добрый", "доброе", "день", "вечер", "утро", "коллеги",
  "ребята", "ребят", "друзья", "народ", "подписчики",
  // question words
  "кто", "что", "как", "где", "когда", "почему", "зачем", "какой", "какая", "какое", "какие",
  "каким", "какую", "чем", "кому", "кого", "куда", "откуда", "сколько", "нибудь", "либо",
  // function words
  "для", "при", "про", "без", "или", "это", "эти", "тут", "там", "уже", "еще", "все", "вот",
  "так", "тоже", "также", "очень", "если", "чтобы", "меня", "мне", "нас", "вас", "вам", "нам",
]);

/** Marketplace / seller context: the audience's background vocabulary (closed list, whole words). */
const CONTEXT_WORDS = new Set([
  "wb", "вб", "озон", "озона", "озоне", "ozon", "wildberries", "вайлдберриз", "вайлдберис",
  "вайлдбериз", "яндекс", "яндекса", "yandex", "маркет", "маркета", "маркетплейс", "маркетплейса",
  "маркетплейсе", "маркетплейсы", "маркетплейсов", "маркетплейсам", "маркетплейсах", "мегамаркет",
  "megamarket", "селлер", "селлера", "селлеру", "селлеры", "селлеров", "селлерам", "селлерами",
  "seller", "sellers", "товар", "товара", "товары", "товаров", "товаре", "товарам", "склад",
  "склада", "складе", "склады", "складов",
]);

function wordsOf(text: string): string[] {
  return normalizeYo(text.toLowerCase())
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function stemOf(word: string): string {
  return word.length >= STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word;
}

type ProtectedVocabulary = { terms: string[]; words: Set<string>; stems: Set<string> };

function protectedVocabulary(settings: StopListSettings): ProtectedVocabulary {
  const terms = [
    ...splitTerms(settings.keywords || ""),
    ...splitTerms(settings.hotSignals || ""),
    ...splitTerms(settings.learnExamples || ""),
  ].map(normalizeYo);
  const words = new Set<string>();
  for (const term of terms) {
    for (const w of wordsOf(term)) {
      if (w.length >= MIN_PROTECTED_WORD_LENGTH && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  for (const text of [settings.product || "", settings.leadCriteria || ""]) {
    for (const w of wordsOf(text)) {
      if (w.length >= MIN_DESCRIPTION_WORD_LENGTH && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  return { terms, words, stems: new Set([...words].map(stemOf)) };
}

function isContentWord(word: string): boolean {
  return word.length >= MIN_CONTENT_WORD_LENGTH && !GENERIC_WORDS.has(word);
}

/** Same 5-letter stem ("остатков" ~ "остатки"), a fragment of a protected word ("склад" in "мойсклад"), or context. */
function isProtectedWord(word: string, vocab: ProtectedVocabulary): boolean {
  if (CONTEXT_WORDS.has(word) || WEAK_PLUS_TERMS.has(word)) return true;
  if (word.length < MIN_PROTECTED_WORD_LENGTH) return false;
  if (vocab.stems.has(stemOf(word))) return true;
  for (const p of vocab.words) if (p.includes(word) || word.includes(p)) return true;
  return false;
}

function rejectsCandidate(candidate: string, vocab: ProtectedVocabulary): boolean {
  if (candidate.length < MIN_CANDIDATE_LENGTH || candidate.length > MAX_MINUS_TERM_LENGTH) return true;
  if (WEAK_PLUS_TERMS.has(candidate)) return true;
  const content = wordsOf(candidate).filter(isContentWord);
  if (!content.length) return true;
  // The whole candidate sits inside a positive term ("синхронизация остатков" ⊃ "остатков").
  if (vocab.terms.some((p) => p.includes(candidate))) return true;
  if (content.length === 1) {
    const single = vocab.terms.some(
      (p) => p.length >= MIN_PROTECTED_TERM_LENGTH && candidate.includes(p),
    );
    return single || isProtectedWord(content[0] as string, vocab);
  }
  // A phrase is only dropped when every content word is protected ("яндекс директ" stays).
  return content.every((w) => isProtectedWord(w, vocab));
}

/**
 * Keep only minus candidates that cannot hit the product's own leads.
 * Deduplicates case-insensitively (ё=е), keeps first spelling and order.
 */
export function sanitizeMinusTerms(
  candidates: readonly string[],
  settings: StopListSettings,
): string[] {
  const vocab = protectedVocabulary(settings);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const original = String(raw || "").trim();
    const key = normalizeYo(original.toLowerCase());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!rejectsCandidate(key, vocab)) out.push(original);
  }
  return out;
}

function csvTerms(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Re-run the stored stop-lists through {@link sanitizeMinusTerms}; pure, for cleanup of polluted settings. */
export function cleanStopLists(settings: StopListSettings): CleanedStopLists {
  const removed: string[] = [];
  const clean = (raw: string): string => {
    const terms = csvTerms(raw);
    const kept = sanitizeMinusTerms(terms, settings);
    const keptKeys = new Set(kept.map((t) => t.toLowerCase()));
    for (const t of terms) {
      const k = t.toLowerCase();
      if (!keptKeys.has(k) && !removed.includes(k)) removed.push(k);
    }
    return kept.join(", ");
  };
  return {
    minusKeywords: clean(settings.minusKeywords || ""),
    avoidTopics: clean(settings.avoidTopics || ""),
    removed,
  };
}

/**
 * The one ordered stop list a scan uses, for the TS core AND the Python worker:
 * minusKeywords (newest first, as learning prepends) then avoidTopics, sanitized at read time so
 * polluted tenants recover without a manual cleanup, deduplicated, capped at MAX_MINUS_TERMS.
 */
export function scanStopTerms(settings: StopListSettings): string[] {
  const merged = [...csvTerms(settings.minusKeywords || ""), ...csvTerms(settings.avoidTopics || "")];
  return sanitizeMinusTerms(merged, settings).slice(0, MAX_MINUS_TERMS);
}
