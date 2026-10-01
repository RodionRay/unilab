#!/usr/bin/env node
// Screenshot the «Найти чаты с клиентами» dialog in every state × viewport × theme from states.mjs.
//   node capture.mjs --url http://127.0.0.1:5191 --storage <storage.json> --out <dir>
//                    [--states all,db] [--themes dark,light] [--plan ./states.mjs]
// Writes <out>/<state>-<width>[-light].png and <out>/report.json
// (per shot: telegramConnected from GET /api/workspace, console errors, page errors, step error).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, TOOLS_DIR, parseArgs } from "./lib-env.mjs";

function loadChromium() {
  const bases = [process.env.PLAYWRIGHT_BASE, REPO, join(homedir(), ".claude/tools")].filter(Boolean);
  const npx = join(homedir(), ".npm/_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) bases.push(join(npx, d));
  for (const base of bases) {
    const req = createRequire(join(base, "package.json"));
    for (const mod of ["@playwright/test", "playwright"]) {
      try { return { chromium: req(mod).chromium, from: req.resolve(mod) }; } catch { /* next */ }
    }
  }
  throw new Error("playwright not found; set PLAYWRIGHT_BASE to a dir whose node_modules has @playwright/test or playwright");
}

const args = parseArgs(process.argv.slice(2));
for (const k of ["url", "storage", "out"]) {
  if (typeof args[k] !== "string") {
    console.error("usage: node capture.mjs --url <base> --storage <storage.json> --out <dir> [--states a,b] [--themes dark,light] [--plan states.mjs]");
    process.exit(2);
  }
}
const plan = await import(pathToFileURL(resolve(typeof args.plan === "string" ? args.plan : join(TOOLS_DIR, "states.mjs"))).href);
const baseUrl = args.url.replace(/\/$/, "");
const outDir = resolve(args.out);
const pick = (arg, all) => (typeof arg === "string" ? arg.split(",").map((s) => s.trim()).filter(Boolean) : all);
const stateNames = pick(args.states, Object.keys(plan.STATES));
const themeNames = pick(args.themes, Object.keys(plan.THEMES));
mkdirSync(outDir, { recursive: true });

const { chromium, from } = loadChromium();
console.log(`playwright: ${from}`);

const asText = (v) => (v instanceof RegExp ? v : String(v));

async function runStep(page, dialog, step) {
  const scope = (s) => (s?.page ? page : dialog);
  if (step.goto) return page.goto(baseUrl + step.goto, { waitUntil: "domcontentloaded" });
  if (step.click) {
    const { role, name, nth = 0 } = step.click;
    const loc = scope(step.click).getByRole(role, { name: asText(name) }).nth(nth);
    await loc.scrollIntoViewIfNeeded();
    return loc.click();
  }
  if (step.clickText) return dialog.getByText(asText(step.clickText)).nth(step.nth || 0).click();
  if (step.fill) return dialog.getByPlaceholder(asText(step.fill.placeholder)).first().fill(step.fill.value);
  if (step.check) {
    const { role = "checkbox", count, skip = [] } = step.check;
    const boxes = dialog.getByRole(role);
    let done = 0;
    for (let i = 0; i < (await boxes.count()) && done < count; i++) {
      const box = boxes.nth(i);
      const label = `${(await box.getAttribute("aria-label")) || ""} ${await box.evaluate((el) => el.closest("label")?.textContent || "")}`;
      if (skip.some((re) => re.test(label))) continue;
      if ((await box.getAttribute("aria-checked")) === "true" || (await box.isChecked().catch(() => false))) continue;
      await box.scrollIntoViewIfNeeded();
      await box.click();
      done++;
    }
    if (done < count) throw new Error(`check: only ${done}/${count} checkboxes found`);
    return;
  }
  if (step.scrollTo) return dialog.getByText(asText(step.scrollTo)).first().scrollIntoViewIfNeeded();
  if (step.waitText) return scope(step).getByText(asText(step.waitText)).first().waitFor({ state: "visible", timeout: step.timeout || 15_000 });
  if (step.waitGone) return dialog.getByText(asText(step.waitGone)).first().waitFor({ state: "hidden", timeout: step.timeout || 10_000 });
  if (step.wait) return page.waitForTimeout(step.wait);
  if (step.stallTimers) {
    return page.evaluate(({ delay, ms }) => {
      const orig = window.setTimeout;
      window.setTimeout = (fn, d, ...rest) => orig(fn, d === delay ? ms : d, ...rest);
    }, step.stallTimers);
  }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

async function settle(page, dialog) {
  await dialog.getByText(plan.BUSY_TEXT).first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(350); // dialog/zoom animations
}

async function shoot(browser, stateName, vp, themeName) {
  const theme = plan.THEMES[themeName];
  const file = `${stateName}-${vp.width}${theme.suffix}.png`;
  const entry = { state: stateName, width: vp.width, height: vp.height, theme: themeName, file, telegramConnected: null, consoleErrors: [], pageErrors: [], error: null };
  const context = await browser.newContext({ storageState: args.storage, viewport: vp, colorScheme: theme.colorScheme, locale: "ru-RU", deviceScaleFactor: 1 });
  if (theme.init) await context.addInitScript(theme.init);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("console", (m) => { if (m.type() === "error") entry.consoleErrors.push(m.text().slice(0, 500)); });
  page.on("pageerror", (e) => entry.pageErrors.push(String(e.message || e).slice(0, 500)));
  page.on("response", async (r) => {
    if (r.request().method() === "GET" && new URL(r.url()).pathname === "/api/workspace") {
      try { entry.telegramConnected = !!(await r.json()).telegramConnected; } catch { /* body gone */ }
    }
  });
  const dialog = page.getByRole(plan.DIALOG.role, { name: plan.DIALOG.name });
  const state = plan.STATES[stateName];
  try {
    const run = async (steps, phase) => {
      for (const [i, step] of steps.entries()) {
        if (step.maxWidth && vp.width > step.maxWidth) continue;
        if (step.minWidth && vp.width < step.minWidth) continue;
        try { await runStep(page, dialog, step); } catch (e) {
          throw new Error(`${phase} step ${i} ${JSON.stringify(step, (_k, v) => (v instanceof RegExp ? String(v) : v))}: ${String(e.message || e).split("\n")[0]}`);
        }
      }
    };
    await run(plan.OPEN, "open");
    await settle(page, dialog);
    await run(state.steps, "state");
    if (state.settle !== false) await settle(page, dialog);
    entry.busyVisibleAtShot = await dialog.getByText(plan.BUSY_TEXT).first().isVisible().catch(() => false);
  } catch (e) {
    entry.error = String(e.message || e).split("\n")[0];
  }
  await page.screenshot({ path: join(outDir, file), animations: state.settle === false ? "allow" : "disabled", caret: "hide" });
  await context.close();
  console.log(`${entry.error ? "FAIL" : "ok  "} ${file}${entry.error ? ` — ${entry.error}` : ""}`);
  return entry;
}

const browser = await chromium.launch();
const shots = [];
try {
  for (const themeName of themeNames) {
    for (const vp of plan.VIEWPORTS.filter((v) => plan.THEMES[themeName].widths.includes(v.width))) {
      for (const stateName of stateNames) shots.push(await shoot(browser, stateName, vp, themeName));
    }
  }
} finally {
  await browser.close();
}
const report = { baseUrl, createdAt: new Date().toISOString(), shots };
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failed = shots.filter((s) => s.error).length;
console.log(`${shots.length} shots, ${failed} failed, telegramConnected=${[...new Set(shots.map((s) => s.telegramConnected))].join("/")} → ${outDir}`);
process.exit(failed ? 1 : 0);
