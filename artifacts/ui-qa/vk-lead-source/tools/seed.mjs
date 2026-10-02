#!/usr/bin/env node
// Seed the local D1 of the UI-QA stand with FAKE data for the VK lead source screens
// (Leads platform badge/filter, Accounts VK section, Groups VK sources).
//   node seed.mjs [--empty-vk]
//   --empty-vk: no vk_account / vk_source / VK leads → first-use empty states.
// Idempotent: fixed `uiqa-*` / fixed-UUID ids; removes other admin-owned rows of the seeded kinds.
// Tokens are never seeded: vk_account.secret stays NULL (the UI must never see one anyway).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, parseArgs } from "./lib-env.mjs";

const OWNER = "admin";
const args = parseArgs(process.argv.slice(2));
const emptyVk = args["empty-vk"] === true;

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const isoAhead = (minutes) => new Date(now + minutes * 60_000).toISOString();
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const proxy = (n, status, host) => ({
  id: uuid(100 + n), kind: "proxy",
  data: { name: `Прокси ${n}`, host, port: "1080", protocol: "socks5", username: "", status, exitIp: status === "active" ? host : "", lastChecked: iso(40), checkError: status === "active" ? "" : "Таймаут подключения" },
});
const proxies = [proxy(1, "active", "203.0.113.11"), proxy(2, "active", "203.0.113.12"), proxy(3, "inactive", "203.0.113.13")];

const account = (n) => ({
  id: uuid(200 + n), kind: "account",
  data: {
    name: `Тестовый аккаунт ${n}`, phone: `+7900000000${n}`, proxyId: proxies[0].id, status: "active", format: "tdata",
    sessionMode: "keep", limits: { invite: 20, message: 20, chat: 20, memberInvite: 40 }, cooldownUntil: "",
    firstName: "Тестовый", lastName: `Аккаунт ${n}`, username: `uiqa_test_${n}`, about: "", hasPhoto: false, error: "",
  },
});
const accounts = [account(1), account(2)];

const group = (n, name, url, leadsTotal) => ({
  id: uuid(300 + n), kind: "group",
  data: {
    name, url, accountId: accounts[0].id, status: "active", error: "", source: "Тестовые данные", membership: "joined",
    joinedAt: iso(60 * 24 * n), joinState: "", joinStateAt: "", joinStateError: "",
    leadsTotal, leadsHot: Math.floor(leadsTotal / 3), leadsWarm: Math.floor(leadsTotal / 3), leadsCold: leadsTotal - 2 * Math.floor(leadsTotal / 3),
    scanMatched: 0, rating: 3, lastScanned: iso(25 * n), scanLog: [],
  },
});
const groups = [
  group(1, "Тестовый чат селлеров WB", "https://t.me/wildberries_sllr", 12),
  group(2, "Тестовый чат Ozon", "https://t.me/ozon_mplace", 4),
];

const SRC_SEARCH = uuid(500);
const SRC_GROUP_OK = uuid(501);
const SRC_GROUP_ERR = uuid(502);
const SRC_GROUP_NEW = uuid(503);

const lead = (n, minutesAgo, extra) => ({
  id: uuid(400 + n), kind: "lead", created: iso(minutesAgo),
  data: {
    status: "new", temperature: "warm", draft: "", reason: "", viewed: false, viewedAt: "", replies: [],
    conversationOpen: false, conversationAt: "", incomingLastText: "", needsManager: false, ...extra,
  },
});
const LONG_VK = "Добрый день! Мы продаём на Wildberries и Ozon уже третий год, кабинетов четыре, остатки ведём в МойСклад и постоянно расходимся с маркетплейсами на десятки позиций. Ищем сервис, который сам синхронизирует остатки и цены между кабинетами и 1С, плюс отвечает на отзывы. Кто чем пользуется, поделитесь опытом, бюджет есть, готовы на демо на этой неделе.";
const tgLeads = [
  lead(1, 15, { name: "Ирина Тестова", message: "Подскажите сервис для синхронизации остатков WB и МойСклад, кто пользуется?", source: groups[0].data.name, groupId: groups[0].id, tgMsgId: "1201", temperature: "hot", reason: "Ищет сервис синхронизации остатков" }),
  lead(2, 70, { name: "Пётр Тестовый", message: "Нужна crm для нескольких кабинетов Ozon, посоветуйте", source: groups[1].data.name, groupId: groups[1].id, tgMsgId: "877", temperature: "warm", reason: "Запрос CRM под несколько кабинетов" }),
  lead(3, 300, { name: "Тестовый селлер", message: "Кто автоматизировал ответы на отзывы? Интересует опыт.", source: groups[0].data.name, groupId: groups[0].id, tgMsgId: "1188", temperature: "cold" }),
];
const vkLeads = [
  lead(10, 5, { name: "Анна Тестовая", message: "Ищу сервис аналитики для селлеров Wildberries, чтобы видеть остатки и цены в одном окне. Посоветуйте!", source: "Поиск VK по ключевым словам", platform: "vk", msgKey: "vk:-1001_501", url: "https://vk.com/wall-1001_501", vkSourceId: SRC_SEARCH, temperature: "hot", reason: "Прямой запрос сервиса аналитики WB" }),
  lead(11, 45, { name: "Тестовое сообщество «Селлеры»", message: LONG_VK, source: "Тестовое сообщество селлеров", platform: "vk", msgKey: "vk:-2002_77_c12", url: "https://vk.com/wall-2002_77?reply=12", vkSourceId: SRC_GROUP_OK, temperature: "warm", reason: "Ищет синхронизацию остатков между кабинетами и 1С" }),
  lead(12, 200, { name: "Олег Тестовый", message: "В обсуждении: кто подключал МойСклад к Ozon, есть готовые интеграции?", source: "Тестовое сообщество селлеров", platform: "vk", msgKey: "vk:board2002_9_301", url: "https://vk.com/topic-2002_9?post=301", vkSourceId: SRC_GROUP_OK, temperature: "warm" }),
  // A tampered URL must never become a link (security blocker): the card shows no «Открыть в VK».
  lead(13, 400, { name: "Тестовый пользователь", message: "Нужен подрядчик по карточкам Ozon, бюджет обсудим.", source: "Поиск VK по ключевым словам", platform: "vk", msgKey: "vk:-1001_502", url: "javascript:alert(1)", vkSourceId: SRC_SEARCH, temperature: "cold" }),
];

const vkAccount = (n, data) => ({
  id: uuid(600 + n), kind: "vk_account",
  data: { vkUserId: 1000 + n, proxyId: proxies[n % 2].id, error: "", tokenFp: `fp${n}`, expiresIn: 0, counters: { day, calls: 0, searchCalls: 0 }, ...data },
});
const vkAccounts = [
  vkAccount(1, { name: "Мария Тестова", status: "active", counters: { day, calls: 214, searchCalls: 38 } }),
  vkAccount(2, { name: "Тестовый Аккаунт Два", status: "active", counters: { day, calls: 96, searchCalls: 12 } }),
  vkAccount(3, { name: "Константин Тестовый-Длиннофамильный", status: "cooldown", cooldownUntil: isoAhead(42), error: "VK 9: слишком много однотипных действий", counters: { day, calls: 480, searchCalls: 500 } }),
  vkAccount(4, { name: "Ольга Тестова", status: "error", error: "Токен не принят: VK 5 User authorization failed: invalid access_token (4).", counters: { day: "2026-09-29", calls: 31, searchCalls: 3 } }),
  vkAccount(5, { vkUserId: 0, name: "Не проверен", status: "no_proxy", proxyId: "", error: "Нет свободного активного прокси" }),
];

const vkSource = (id, minutesAgo, data) => ({
  id, kind: "vk_source", created: iso(minutesAgo),
  data: { cursor: {}, lastScanAt: "", error: "", leadTombstones: [], scanLog: [], ...data },
});
const vkSources = [
  vkSource(SRC_SEARCH, 600, { type: "search", title: "Поиск VK по ключевым словам", lastScanAt: iso(12), leadsTotal: 2, leadsHot: 1, leadsWarm: 0, leadsCold: 1, scanLog: [{ at: iso(12), level: "ok", text: "VK · +1 · запросов 8 · найдено 412 → ядро 9 → AI/match 2" }] }),
  vkSource(SRC_GROUP_OK, 500, { type: "group", title: "Тестовое сообщество селлеров", vkGroupId: 2002, screenName: "test_sellers", url: "https://vk.com/club2002", lastScanAt: iso(48), leadsTotal: 2, leadsHot: 0, leadsWarm: 2, leadsCold: 0 }),
  vkSource(SRC_GROUP_ERR, 400, { type: "group", title: "Тестовое закрытое сообщество поставщиков маркетплейсов Wildberries, Ozon и Яндекс Маркета", vkGroupId: 3003, screenName: "", url: "https://vk.com/club3003", lastScanAt: iso(180), error: "Сообщество закрыто или стена недоступна (VK 15 Access denied)" }),
  vkSource(SRC_GROUP_NEW, 100, { type: "group", title: "Тестовый паблик поставщиков", vkGroupId: 4004, screenName: "test_suppliers", url: "https://vk.com/club4004" }),
];

const settings = {
  id: "uiqa-settings", kind: "settings",
  data: {
    name: "Тестовый бизнес", model: "deepseek-chat", provider: "deepseek", apiBase: "https://api.deepseek.com", projectUrl: "",
    product: "Тестовый сервис аналитики для селлеров Wildberries и Ozon.", audience: "Селлеры маркетплейсов",
    keywords: "ищу сервис, аналитика wildberries, синхронизация остатков, мойсклад", minusKeywords: "вакансия",
    aiQualify: false, autoRescanEnabled: false, autoRescanMinutes: 30, scanDepthDays: 7, lastAutoRescanAt: iso(12),
  },
};

const records = [
  ...proxies, ...accounts, ...groups, ...tgLeads, settings,
  ...(emptyVk ? [] : [...vkLeads, ...vkAccounts, ...vkSources]),
];

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const keep = records.map((r) => q(r.id)).join(",");
const kinds = ["proxy", "account", "group", "lead", "settings", "vk_account", "vk_source"].map(q).join(",");
const sql = [
  `DELETE FROM records WHERE owner=${q(OWNER)} AND kind IN (${kinds}) AND id NOT IN (${keep});`,
  ...records.map((r, i) =>
    `INSERT INTO records(id,owner,kind,data,secret,created) VALUES(${q(r.id)},${q(OWNER)},${q(r.kind)},${q(JSON.stringify(r.data))},NULL,${q(r.created || iso(1000 + records.length - i))}) ` +
    `ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,kind=excluded.kind,data=excluded.data,secret=NULL,created=excluded.created;`),
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "uiqa-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql);
const res = spawnSync(process.execPath, [
  "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
  "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/state", "--config", "dist/server/wrangler.json", "--file", file,
], { cwd: REPO, encoding: "utf8" });
rmSync(dir, { recursive: true, force: true });
if (res.status !== 0) {
  console.error(res.stdout, res.stderr);
  process.exit(res.status ?? 1);
}
console.log(`seeded ${records.length} records for owner=${OWNER}${emptyVk ? " (no VK data)" : ""}`);
