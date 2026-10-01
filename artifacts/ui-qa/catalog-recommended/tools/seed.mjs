#!/usr/bin/env node
// Seed the local D1 of the UI-QA stand with FAKE data for the «Найти чаты с клиентами» dialog.
//   node seed.mjs [--no-workable] [--no-groups]
//   --no-workable: every account non-workable → disabled-state variant; --no-groups: zero groups → «Мои группы» first-use empty
// Idempotent: upserts fixed `uiqa-*` ids and removes any other admin-owned account/group/settings rows,
// so every run leaves the same state. Only touches <repo>/.wrangler/state (the stand's own DB).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, parseArgs } from "./lib-env.mjs";

const OWNER = "admin"; // lib/auth.ts::ADMIN_USER_ID; workspace owner of the admin session
const args = parseArgs(process.argv.slice(2));
const noWorkable = args["no-workable"] === true;
const noGroups = args["no-groups"] === true;

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

const account = (n, status) => ({
  id: `uiqa-acc-${n}`,
  kind: "account",
  data: {
    name: `Тестовый аккаунт ${n}`, phone: `+000000000${n}`, proxyId: "", status, format: "manual",
    sessionMode: "keep", limits: { invite: 20, message: 20, chat: 20, memberInvite: 40 }, cooldownUntil: "",
    firstName: "Тестовый", lastName: `Аккаунт ${n}`, username: `uiqa_test_${n}`, about: "", hasPhoto: false, error: "",
  },
});

// Public URLs taken from lib/group-catalog.ts::GROUP_CATALOG; names are fake/test labels.
const group = (n, name, url, joined) => ({
  id: `uiqa-grp-${n}`,
  kind: "group",
  data: {
    name, url, accountId: "uiqa-acc-1", status: joined ? "active" : "setup", error: "", source: "Тестовые данные",
    membership: joined ? "joined" : "none", joinedAt: joined ? iso(60 * 24 * n) : "",
    joinState: "", joinStateAt: "", joinStateError: "", leadsTotal: joined ? 3 * n : 0, leadsHot: joined ? n : 0,
    leadsWarm: joined ? n : 0, leadsCold: joined ? n : 0, scanMatched: 0, rating: 0,
    lastScanned: joined ? iso(90) : "", scanLog: [],
  },
});

const LONG_NAME = "Тестовая группа с очень длинным названием: поставщики маркетплейсов, карточки, поставки, логистика и отчёты";

const records = [
  account(1, noWorkable ? "spamblock" : "active"),
  account(2, noWorkable ? "unauthorized" : "active"),
  account(3, "spamblock"),
  group(1, "Тестовая группа WB 1", "https://t.me/wildberries_sllr", true),
  group(2, "Тестовая группа Ozon 2", "https://t.me/ozon_mplace", true),
  group(3, "Тестовая группа мультиселлеров 3", "https://t.me/mp_seller", true),
  group(4, "Тестовая группа WB 4", "https://t.me/wbnetwork", false),
  group(5, "Тестовая группа Ozon 5", "https://t.me/ozon_sllr", false),
  group(6, LONG_NAME, "https://t.me/mplaces_wildberries", false),
  {
    id: "uiqa-settings",
    kind: "settings",
    data: {
      name: "Тестовый бизнес", model: "deepseek-chat", provider: "deepseek", apiBase: "https://api.deepseek.com",
      projectUrl: "",
      product: "Тестовый сервис для селлеров маркетплейсов Wildberries и Ozon: синхронизация остатков, управление ценами, ответы на отзывы.",
      audience: "Селлеры маркетплейсов (Wildberries, Ozon, Яндекс Маркет)",
      keywords: "маркетплейсы, wildberries, ozon, остатки, цены, отзывы",
      leadCriteria: "Ищет сервис для работы на маркетплейсах", pains: "Ручная синхронизация остатков",
      valueProps: "Автоматизация кабинетов маркетплейсов", hotSignals: "ищу сервис для wildberries",
      aiQualify: false, autoRescanEnabled: false, autoRescanMinutes: 30,
    },
  },
];

if (records.find((r) => r.id === "uiqa-grp-6").data.name.length < 80) throw new Error("long name must be >= 80 chars");
if (noGroups) records.splice(0, records.length, ...records.filter((r) => r.kind !== "group"));

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const keep = records.map((r) => q(r.id)).join(",");
const sql = [
  `DELETE FROM records WHERE owner=${q(OWNER)} AND kind IN ('account','group','settings') AND id NOT IN (${keep});`,
  ...records.map((r, i) =>
    `INSERT INTO records(id,owner,kind,data,secret,created) VALUES(${q(r.id)},${q(OWNER)},${q(r.kind)},${q(JSON.stringify(r.data))},NULL,${q(iso(records.length - i))}) ` +
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
console.log(`seeded ${records.length} records for owner=${OWNER}${noWorkable ? " (no workable accounts)" : ""}${noGroups ? " (no groups)" : ""}`);
