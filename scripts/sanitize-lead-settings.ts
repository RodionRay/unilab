import Database from "better-sqlite3";
import { strongPlusTerms } from "../lib/lead-filter.ts";
import { mergeKeywords } from "../lib/ai-keywords.ts";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const db = new Database(DB);
const row = db.prepare("SELECT id,data FROM records WHERE kind='settings' LIMIT 1").get() as
  | { id: string; data: string }
  | undefined;
if (!row) {
  console.log("no settings");
  process.exit(0);
}
const d = JSON.parse(row.data);
const junk =
  "вакансия, резюме, куплю аккаунт, продаю аккаунт, накрутка, казино, крипта, взлом, курсы инфобиз, заработок без вложений, матрица судьбы, таро, гадание, астролог, нумеролог, эзотерика, писать @";
const before = d.keywords;
d.keywords = strongPlusTerms(d.keywords || "").join(", ");
d.minusKeywords = mergeKeywords(d.minusKeywords || "", junk);
d.leadCriteria =
  "Целевой лид ЯВНО ищет сервис/инструмент/подрядчика под ваш продукт (остатки, синхронизация, цены, отзывы, кабинеты, 1С/МойСклад) и готов обсуждать демо или внедрение. Не лид: обычный чат селлеров, жалобы без запроса сервиса, чужая реклама.";
d.hotSignals =
  d.hotSignals ||
  "ищу сервис, нужен сервис, кто пользуется, подскажите crm, интеграция 1с, мойсклад, остатки синхронизация, ответы на отзывы";
d.avoidTopics = mergeKeywords(
  d.avoidTopics || "",
  "болтовня селлеров без запроса сервиса, жалобы на СПП без запроса инструмента",
);
db.prepare("UPDATE records SET data=? WHERE id=?").run(JSON.stringify(d), row.id);
console.log(
  JSON.stringify(
    { keywordsBefore: String(before).slice(0, 180), keywordsAfter: d.keywords },
    null,
    2,
  ),
);
db.close();
