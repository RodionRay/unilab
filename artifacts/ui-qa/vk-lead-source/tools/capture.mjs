#!/usr/bin/env node
// Screenshot the VK lead source states (Leads / Accounts / Groups) at 390 / 768 / 1440.
//   node capture.mjs --url http://127.0.0.1:5241 --storage <storage.json> --out <dir> [--states a,b] [--before]
// Writes <out>/<state>-<width>.png (full page) and <out>/report.json (console + page errors per shot).
// Waits until the workspace list is loaded (no skeletons) so a slow first load never lands in a shot.
// --before: only states that exist before the change (no clicks on new controls).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO, parseArgs } from "./lib-env.mjs";

function loadChromium() {
  const bases = [process.env.PLAYWRIGHT_BASE, REPO].filter(Boolean);
  const wt = join(homedir(), "worktrees");
  if (existsSync(wt)) for (const d of readdirSync(wt)) bases.push(join(wt, d));
  for (const base of bases) {
    const req = createRequire(join(base, "package.json"));
    for (const mod of ["@playwright/test", "playwright"]) {
      try { return req(mod).chromium; } catch { /* next */ }
    }
  }
  throw new Error("playwright not found; set PLAYWRIGHT_BASE");
}

const args = parseArgs(process.argv.slice(2));
for (const k of ["url", "storage", "out"]) if (typeof args[k] !== "string") { console.error(`missing --${k}`); process.exit(2); }
const base = args.url.replace(/\/$/, "");
const WIDTHS = [[390, 844], [768, 1024], [1440, 900]];

const settle = async (page) => {
  await page.waitForSelector(".workspace", { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector(".workspace [data-slot='skeleton']"), null, { timeout: 60_000 });
  await page.waitForTimeout(700);
};
const hideFab = (page) => page.addStyleTag({ content: ".assistant-root{display:none!important}" });
const openLeadByName = async (page, name) => {
  await page.locator(".lead-row", { hasText: name }).first().locator("button").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10_000 });
  await page.waitForTimeout(500);
};
const pickPlatform = async (page, label) => {
  await page.getByRole("combobox", { name: "Площадка" }).click();
  await page.getByRole("option", { name: label }).click();
  await page.waitForTimeout(400);
};

const STATES = {
  "leads-all": { route: "/app?view=leads", before: true },
  "leads-vk": { route: "/app?view=leads", run: (p) => pickPlatform(p, "VK") },
  "leads-telegram": { route: "/app?view=leads", run: (p) => pickPlatform(p, "Telegram") },
  "accounts": { route: "/app?view=accounts", before: true },
  "accounts-import": {
    route: "/app?view=accounts",
    run: async (p) => {
      const box = p.getByLabel("Список VK-аккаунтов");
      await box.fill([
        "seller_login:password-is-dropped",
        "этоНеТокен",
        "https://oauth.vk.com/blank.html#expires_in=0&user_id=1",
        "vk1.a.TESTONLYtokenTESTONLYtokenTESTONLYtoken01",
        "vk1.a.TESTONLYtokenTESTONLYtokenTESTONLYtoken01",
      ].join("\n"));
      await p.getByRole("button", { name: /Импортировать/ }).click();
      await p.waitForSelector(".vk-import-results", { timeout: 90_000 });
      await p.waitForFunction(() => !document.querySelector(".vk-import-progress"), null, { timeout: 90_000 });
      await p.waitForTimeout(400);
    },
  },
  "groups": { route: "/app?view=groups", before: true },
  "lead-detail-tg": { route: "/app?view=leads", before: true, run: (p) => openLeadByName(p, "Ирина Тестова") },
  "lead-detail-vk": { route: "/app?view=leads", before: true, run: (p) => openLeadByName(p, "Анна Тестовая") },
  "lead-detail-vk-badurl": { route: "/app?view=leads", run: (p) => openLeadByName(p, "Тестовый пользователь") },
};

const wanted = typeof args.states === "string" ? args.states.split(",") : Object.keys(STATES);
const chromium = loadChromium();
const browser = await chromium.launch();
mkdirSync(args.out, { recursive: true });
const report = [];
for (const name of wanted) {
  const st = STATES[name];
  if (!st || (args.before && !st.before)) continue;
  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, storageState: args.storage, colorScheme: "dark" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
    // Opening a lead marks it viewed (hidden from the grid); keep the seed stable across shots.
    await page.route("**/api/workspace", (route) => {
      const body = route.request().postData() || "";
      if (route.request().method() === "POST" && body.includes('"mark_lead_viewed"')) {
        return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      }
      return route.continue();
    });
    let stepError = "";
    try {
      await page.goto(base + st.route, { waitUntil: "domcontentloaded" });
      await settle(page);
      await hideFab(page);
      if (st.run && !args.before) await st.run(page);
      else if (st.run && args.before && name.startsWith("lead-detail")) await st.run(page);
    } catch (e) { stepError = String(e.message || e).split("\n")[0]; }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const file = join(args.out, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: !name.startsWith("lead-detail") });
    report.push({ state: name, width: w, file, errors, stepError });
    console.log(`${name}-${w}${stepError ? ` STEP ERROR: ${stepError}` : ""}${errors.length ? ` (${errors.length} console errors)` : ""}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(args.out, "report.json"), JSON.stringify(report, null, 2));
