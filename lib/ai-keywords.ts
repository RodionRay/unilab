/**
 * Подсказки плюс/минус слов для формы настроек (UI). Автообучение стоп-слов удалено (lead core v2
 * REQ-21/22): стоп-слова меняет только владелец в карточке проекта.
 */

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

export function unusedSuggestions(
  current: string,
  pool: readonly string[],
): string[] {
  const have = new Set(parseKeywordCsv(current).map((s) => s.toLowerCase()));
  return pool.filter((p) => !have.has(p.toLowerCase()));
}
