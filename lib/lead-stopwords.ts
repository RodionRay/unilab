/**
 * Guards the lead stop-lists (minusKeywords / avoidTopics) against auto-learning pollution.
 *
 * Auto-learning (train_from_hot / train_from_ignored / reject_lead_stopwords) used to append the
 * product's own vocabulary ("остатков", "озон", "селлер", "нал", "бот" …) to the stop-lists, and
 * every scan then dropped exactly the messages we look for. A minus candidate is rejected here when
 * it is short, generic, marketplace context, or overlaps the positive settings of the assistant.
 */

import { WEAK_PLUS_TERMS, splitTerms } from "@/lib/lead-filter";

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
const STEM_LENGTH = 5;
const MIN_PROTECTED_TERM_LENGTH = 4;
const MIN_PROTECTED_WORD_LENGTH = 4;
const MIN_DESCRIPTION_WORD_LENGTH = 5;

/** Words a real buyer uses to ask; a stop-list made only of them kills every lead. */
const GENERIC_WORDS = new Set([
  "помогите",
  "помоги",
  "подскажите",
  "подскажи",
  "посоветуйте",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "ищу",
  "ищем",
  "скажите",
  "пожалуйста",
  "здравствуйте",
  "привет",
  "всем",
  "добрый",
  "день",
  "вечер",
  "кто",
  "пользуется",
  "пользовался",
  "спасибо",
  "вопрос",
  "коллеги",
  "ребята",
]);

/** Marketplace / seller context: the audience's background vocabulary, never a stop signal. */
const MARKETPLACE_WORD_RE =
  /^(?:wb|вб|озон|ozon|wildberries|вайлдберр|яндекс|yandex|маркет|megamarket|мегамаркет|селлер|seller|товар)/u;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
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
  ];
  const words = new Set<string>();
  for (const term of terms) {
    for (const w of wordsOf(term)) {
      if (w.length >= MIN_PROTECTED_WORD_LENGTH && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  for (const text of [settings.product || "", settings.leadCriteria || ""]) {
    for (const w of wordsOf(text)) {
      if (w.length >= MIN_DESCRIPTION_WORD_LENGTH) words.add(w);
    }
  }
  return { terms, words, stems: new Set([...words].map(stemOf)) };
}

function isGeneric(words: string[]): boolean {
  return words.every((w) => GENERIC_WORDS.has(w));
}

function isContextWord(word: string): boolean {
  return WEAK_PLUS_TERMS.has(word) || MARKETPLACE_WORD_RE.test(word);
}

function overlapsProtected(candidate: string, words: string[], vocab: ProtectedVocabulary): boolean {
  const termOverlap = vocab.terms.some(
    (p) =>
      p.includes(candidate) ||
      (p.length >= MIN_PROTECTED_TERM_LENGTH && candidate.includes(p)),
  );
  if (termOverlap) return true;
  // Word level: same 5-letter stem ("остатков" ~ "остатки") or a fragment of a protected word ("склад" in "мойсклад").
  return words.some(
    (w) =>
      w.length >= MIN_PROTECTED_WORD_LENGTH &&
      (vocab.stems.has(stemOf(w)) || [...vocab.words].some((p) => p.includes(w) || w.includes(p))),
  );
}

function rejectsCandidate(candidate: string, vocab: ProtectedVocabulary): boolean {
  if (candidate.length < MIN_CANDIDATE_LENGTH) return true;
  if (WEAK_PLUS_TERMS.has(candidate)) return true;
  const words = wordsOf(candidate);
  if (!words.length || isGeneric(words)) return true;
  if (words.some(isContextWord)) return true;
  return overlapsProtected(candidate, words, vocab);
}

/**
 * Keep only minus candidates that cannot hit the product's own leads.
 * Deduplicates case-insensitively, keeps first spelling and order.
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
    const key = original.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!rejectsCandidate(key, vocab)) out.push(original);
  }
  return out;
}

/** Re-run the stored stop-lists through {@link sanitizeMinusTerms}; pure, for cleanup of polluted settings. */
export function cleanStopLists(settings: StopListSettings): CleanedStopLists {
  const removed: string[] = [];
  const clean = (raw: string): string => {
    const terms = raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
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
