#!/usr/bin/env node
/**
 * Seeds SYNTHETIC «Переписки» data (fictional names, no real Telegram ids) into a running local cabinet —
 * for screenshots and the chats e2e. Never point it at a real workspace.
 *
 * Usage: DEMO_URL=http://localhost:5173 DEMO_EMAIL=admin@uniseller.local DEMO_PASSWORD=... node scripts/seed-demo-chats.mjs
 * Prints JSON {accounts, groups, leads} with the created ids.
 */
const base = (process.env.DEMO_URL || "http://localhost:5173").replace(/\/$/, "");
const email = process.env.DEMO_EMAIL || "admin@uniseller.local";
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error("DEMO_PASSWORD is required");
  process.exit(2);
}

let cookie = "";
async function post(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
const save = (kind, data) => post("/api/workspace", { action: "save", kind, data }).then((r) => r.id);

const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();
const us = (text, min, extra = {}) => ({ text, mode: "dm", at: ago(min), ok: true, error: "", messageId: String(1000 + min), link: "", chatId: "", from: "us", status: "sent", ...extra });
const client = (text, min) => ({ text, mode: "dm", at: ago(min), ok: true, error: "", messageId: String(2000 + min), link: "", chatId: "", from: "client" });

await post("/api/auth/login", { email, password });

const accounts = [
  await save("account", { name: "Продажи 1", phone: "+70000000001", status: "active", firstName: "Мария", lastName: "Продажи", username: "demo_sales_1" }),
  await save("account", { name: "Продажи 2", phone: "+70000000002", status: "active", firstName: "Илья", lastName: "Продажи", username: "demo_sales_2" }),
];
const groups = [
  await save("group", { name: "Селлеры Wildberries — чат", url: "https://t.me/demo_sellers_chat", accountId: accounts[0], status: "active", membership: "joined" }),
  await save("group", { name: "Ozon для бизнеса", url: "https://t.me/demo_ozon_biz", accountId: accounts[1], status: "active", membership: "joined" }),
];

const lead = (d) => save("lead", {
  source: "Telegram", status: "working", temperature: "warm", viewed: true, conversationOpen: true,
  messageKind: "group", tgMsgId: "77", replyToMsgId: "77", ...d,
});

const leads = [
  await lead({
    name: "Анна Демидова", senderUsername: "demo_anna", groupId: groups[0], accountId: accounts[0],
    message: "Подскажите сервис, который синхронизирует остатки между WB и Ozon? Устала править руками каждый вечер.",
    temperature: "hot", viewed: false, needsManager: true, conversationAt: ago(2), incomingLastText: "А сколько стоит подключение на два кабинета?",
    replies: [
      us("Анна, добрый день! Видел ваш вопрос в чате селлеров. Мы как раз делаем синхронизацию остатков WB ↔ Ozon.", 95),
      us("Могу показать на демо за 15 минут — удобно сегодня или завтра?", 94),
      client("Здравствуйте! Да, интересно.", 40),
      client("У меня два кабинета на WB и один на Ozon, около 600 SKU.", 39),
      client("А сколько стоит подключение на два кабинета?", 2),
    ],
    draft: "Для двух кабинетов WB и одного Ozon — тариф «Бизнес», 4 900 ₽ в месяц, подключение бесплатно. Показать на демо сегодня в 17:00?",
  }),
  await lead({
    name: "Игорь Ветров", senderUsername: "demo_igor", groupId: groups[1], accountId: accounts[1],
    message: "Ищем подрядчика: автоответы на отзывы Ozon, объём 300 отзывов в неделю.",
    temperature: "hot", viewed: false, conversationAt: ago(18), incomingLastText: "Пришлите, пожалуйста, пример ответа",
    replies: [
      us("Игорь, здравствуйте! Мы закрываем ответы на отзывы автоматически с ручной модерацией.", 300, { mode: "chat" }),
      client("Пришлите, пожалуйста, пример ответа", 18),
    ],
  }),
  await lead({
    name: "Студия «Лён и хлопок»", senderUsername: "", groupId: groups[0], accountId: accounts[0],
    message: "Кто пользовался сервисами репрайсинга? Нужен честный отзыв.",
    conversationAt: ago(60 * 5), incomingLastText: "",
    replies: [
      us("Добрый день! Пишу из чата селлеров по поводу репрайсинга. Можем дать 14 дней бесплатно, чтобы сравнить с текущим решением.", 60 * 5, { status: "failed", ok: false, error: "PEER_FLOOD: аккаунт временно ограничен Telegram" }),
    ],
  }),
  await lead({
    name: "Ольга Кравец", senderUsername: "demo_olga", groupId: groups[1], accountId: accounts[1],
    message: "Нужна интеграция Ozon с МойСклад, кто подскажет?",
    conversationAt: ago(60 * 26), incomingLastText: "Спасибо, посмотрю и вернусь",
    replies: [
      us("Ольга, добрый вечер! Интеграция Ozon ↔ МойСклад у нас из коробки, настройка занимает около часа.", 60 * 27),
      client("Спасибо, посмотрю и вернусь", 60 * 26),
      us("Хорошо! Если появятся вопросы по настройке складов — пишите сюда.", 60 * 26 - 3),
    ],
  }),
  await lead({
    name: "Дмитрий Соколов-Белозерский, руководитель отдела маркетплейсов", senderUsername: "demo_dmitry_long_username_example", groupId: groups[0], accountId: accounts[0],
    message: "Очень длинное сообщение-запрос: у нас 14 юрлиц, на каждом по два-три кабинета на разных площадках, нужна единая панель для цен, остатков и отзывов, с ролями для менеджеров и выгрузкой в 1С. Есть такие решения на рынке или только самописное?",
    conversationAt: ago(60 * 24 * 3), incomingLastText: "",
    replies: [
      us("Дмитрий, здравствуйте! Да, единая панель с ролями и выгрузкой в 1С — наш основной сценарий для групп компаний.", 60 * 24 * 3, { status: "pending" }),
    ],
  }),
  await lead({
    name: "Мебель Плюс", senderUsername: "demo_mebel", groupId: groups[1], accountId: accounts[1],
    message: "Посоветуйте аналитику по конкурентам на WB",
    conversationOpen: false, conversationAt: "",
    draft: "Здравствуйте! Видел ваш вопрос про аналитику конкурентов на WB — можем показать отчёт по вашей нише бесплатно.",
    replies: [],
  }),
];

console.log(JSON.stringify({ accounts, groups, leads }, null, 2));
