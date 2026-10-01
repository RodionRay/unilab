#!/usr/bin/env node
// E2E journeys of the AI page against the mock workspace. Every check prints PASS/FAIL; exit 1 on any FAIL.
// The proxy scenario picks the suite (read from GET /__mock/log): `full` -> checks 1-7, `staff-redacted` -> check 8.
// POST bodies are asserted from the proxy's own log (mock-proxy.mjs `/__mock/log`), not from the browser.
// Usage: node e2e-ai.mjs [--url http://127.0.0.1:8011]   (server + proxy + storage.json, see README)
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { IDS } from './fixtures.mjs';

const HARN = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HARN, '../../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const URL_BASE = args.url || 'http://127.0.0.1:8011';
const STORAGE = path.join(HARN, 'storage.json');
const EXAMPLE_KEYS = ['goodExamples', 'badExamples'];

function playwrightProject() {
  const candidates = [process.env.PW_PROJECT, ROOT, path.join(os.homedir(), '.claude/tools'), path.join(os.homedir(), 'Projects/crm-spa')].filter(Boolean);
  for (const dir of candidates) {
    try { createRequire(path.join(dir, 'package.json')).resolve('@playwright/test'); return dir; } catch { /* next */ }
  }
  throw new Error(`@playwright/test not found in ${candidates.join(', ')}; set PW_PROJECT`);
}

// ---- proxy log ----
async function mockLog() {
  const r = await fetch(`${URL_BASE}/__mock/log`);
  if (!r.ok) throw new Error(`GET /__mock/log -> ${r.status}: restart mock-proxy.mjs with the log endpoint`);
  return r.json();
}
const clearLog = () => fetch(`${URL_BASE}/__mock/log`, { method: 'DELETE' });
const posts = async (action) => (await mockLog()).posts.filter((p) => !action || p.body.action === action);
async function waitForPost(action, predicate = () => true, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = (await posts(action)).find((p) => predicate(p.body));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no POST ${action} within ${timeout} ms; log: ${JSON.stringify((await posts()).map((p) => p.body.action))}`);
}

function assert(cond, message) { if (!cond) throw new Error(message); }
const sameKeys = (obj, keys) => JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());

// ---- page helpers ----
async function openView(browser, view) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: STORAGE });
  const page = await context.newPage();
  page.httpErrors = [];
  page.on('response', (r) => { if (r.url().includes('/api/workspace') && r.status() >= 400) page.httpErrors.push(`${r.request().method()} ${r.status()}`); });
  await page.goto(`${URL_BASE}/app?view=${view}`, { waitUntil: 'networkidle' });
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('redirected to login: run login.mjs');
  return { context, page };
}
const waitAiPage = (page) => page.locator('.aiw-headline').first().waitFor({ timeout: 15000 });
const whoIsLeadField = (page) => page.locator('fieldset.aiw-group', { hasText: 'Кто лид' }).locator('textarea').first();
const queueNames = (page) => page.locator('.aiw-queue-list .aiw-queue-name').allTextContents();

async function editWhoIsLead(page, suffix) {
  const field = whoIsLeadField(page);
  await field.click();
  await field.press('ControlOrMeta+End');
  await field.pressSequentially(suffix);
  await page.locator('.aiw-savebar[data-dirty]').waitFor();
  return field.inputValue();
}

async function saveCard(page) {
  await page.locator('.aiw-save-btn').click();
  await page.locator('.aiw-savebar:not([data-dirty])').waitFor({ timeout: 8000 });
}

async function workspaceRecords(context) {
  const r = await context.request.get(`${URL_BASE}/api/workspace`);
  assert(r.ok(), `GET /api/workspace -> ${r.status()}`);
  return (await r.json()).records;
}

// ---- checks ----
const FULL = {
  '1 funnel headline, two project tabs, tab switch updates URL + card': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      const headline = (await page.locator('.aiw-headline').first().innerText()).trim();
      assert(/AI нашёл/.test(headline), `headline text unexpected: «${headline}»`);
      const tabs = page.locator('nav[aria-label="Проекты"] button.aiw-tab');
      const names = (await tabs.locator('.aiw-tab-name').allTextContents()).map((s) => s.trim());
      assert(names.length === 2 && names.includes('Фулфилмент для WB') && names.includes('Карточки товаров под ключ'), `tabs: ${JSON.stringify(names)}`);
      const nameInput = page.getByLabel('Название проекта');
      assert((await nameInput.inputValue()) === names[0], `card name before switch: ${await nameInput.inputValue()}`);
      await tabs.nth(1).click();
      await page.waitForFunction((id) => new URL(location.href).searchParams.get('project') === id, IDS.projectCards, { timeout: 5000 });
      await page.waitForFunction((n) => document.querySelector('.aiw-card input')?.value === n, names[1], { timeout: 5000 });
      assert((await tabs.nth(1).getAttribute('aria-current')) === 'page', 'second tab not aria-current=page');
      return `headline «${headline}»; project=${IDS.projectCards}; card «${names[1]}»`;
    } finally { await context.close(); }
  },

  '2 edit «Кто лид» + save -> one project_update with only that key': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      await clearLog();
      const value = await editWhoIsLead(page, ' Отгрузки от 300 единиц в месяц.');
      await saveCard(page);
      await page.waitForTimeout(500);
      const updates = await posts('project_update');
      assert(updates.length === 1, `project_update count ${updates.length}`);
      const { id, patch } = updates[0].body;
      assert(id === IDS.projectFulfillment, `project_update id ${id}`);
      assert(sameKeys(patch, ['audience']), `patch keys ${JSON.stringify(Object.keys(patch))}`);
      assert(patch.audience === value, 'patch.audience differs from the textarea value');
      return `patch keys ["audience"], status ${updates[0].status}`;
    } finally { await context.close(); }
  },

  '3 expand funnel row «Стоп-слова» -> samples visible': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      const row = page.locator('button.aiw-row-main', { hasText: 'Стоп-слова' }).first();
      await row.click();
      assert((await row.getAttribute('aria-expanded')) === 'true', 'row aria-expanded not true');
      const sample = page.locator('.aiw-row[data-open] .aiw-sample', { hasText: 'Требуются упаковщики на склад в Подольске' });
      await sample.first().waitFor({ state: 'visible', timeout: 5000 });
      return `${await page.locator('.aiw-row[data-open] .aiw-sample').count()} samples shown`;
    } finally { await context.close(); }
  },

  '4 approval queue: edited send -> send_lead_message; dismiss -> dismiss_draft': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      await page.locator('.aiw-draft').first().waitFor();
      await clearLog();
      const before = await queueNames(page);
      assert(before[0] === 'Марина Кузнецова' && before.includes('Дмитрий Орлов'), `queue before: ${JSON.stringify(before)}`);
      const draft = page.locator('.aiw-draft');
      assert((await draft.getAttribute('aria-label')) === 'Черновик для Марина Кузнецова', `selected draft: ${await draft.getAttribute('aria-label')}`);
      const area = draft.locator('textarea');
      await area.fill('Марина, добрый день. Отгружаем на Коледино ежедневно, пришлю расчёт сегодня.');
      const edited = (await area.inputValue()).trim();
      await draft.getByRole('button', { name: 'Отправить' }).click();
      const sent = await waitForPost('send_lead_message');
      assert(sent.body.id === IDS.lead(1), `send id ${sent.body.id}`);
      assert(sent.body.text === edited, `send text «${sent.body.text}» != edited «${edited}»`);
      await page.waitForFunction(() => ![...document.querySelectorAll('.aiw-queue-list .aiw-queue-name')].some((n) => n.textContent === 'Марина Кузнецова'), null, { timeout: 5000 });

      const next = page.locator('.aiw-draft');
      await page.waitForFunction(() => document.querySelector('.aiw-draft')?.getAttribute('aria-label') === 'Черновик для Дмитрий Орлов', null, { timeout: 5000 });
      await next.getByRole('button', { name: 'Отклонить' }).click();
      const dismissed = await waitForPost('dismiss_draft');
      assert(sameKeys(dismissed.body, ['action', 'id']) && dismissed.body.id === IDS.lead(2), `dismiss body ${JSON.stringify(dismissed.body)}`);
      await page.waitForFunction(() => ![...document.querySelectorAll('.aiw-queue-list .aiw-queue-name')].some((n) => n.textContent === 'Дмитрий Орлов'), null, { timeout: 5000 });
      return `sent ${sent.body.id} mode=${sent.body.mode} (${sent.status}); dismissed ${dismissed.body.id} (${dismissed.status}); queue after: ${JSON.stringify(await queueNames(page))}`;
    } finally { await context.close(); }
  },

  '5 dirty card + sidebar «Лиды» -> leave dialog, «Остаться» keeps view=ai': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      await editWhoIsLead(page, ' Без своего склада.');
      await page.locator('button.nav-item', { hasText: 'Лиды' }).first().click();
      const dialog = page.getByRole('alertdialog', { name: 'Карточка проекта не сохранена' });
      await dialog.waitFor({ timeout: 5000 });
      await dialog.getByRole('button', { name: 'Остаться' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 5000 });
      const view = new URL(page.url()).searchParams.get('view');
      assert(view === 'ai', `view after «Остаться»: ${view}`);
      assert(await page.locator('.aiw-savebar[data-dirty]').isVisible(), 'card lost its edits after «Остаться»');
      return 'dialog shown; view=ai, edits kept';
    } finally { await context.close(); }
  },

  '6 leads view «Хороший лид» -> lead_feedback {id, verdict:good}': async (browser) => {
    const { context, page } = await openView(browser, 'leads');
    try {
      const row = page.locator('.lead-row', { has: page.locator('.row-title', { hasText: 'Анна Морозова' }) }).first();
      await row.waitFor({ timeout: 15000 });
      await clearLog();
      await row.getByRole('button', { name: 'Хороший лид' }).click();
      const fb = await waitForPost('lead_feedback');
      assert(fb.body.id === IDS.lead(5) && fb.body.verdict === 'good', `lead_feedback body ${JSON.stringify(fb.body)}`);
      return `lead_feedback ${JSON.stringify({ id: fb.body.id, verdict: fb.body.verdict })} -> ${fb.status}`;
    } finally { await context.close(); }
  },

  '7 chats view hides auto drafts, shows manual draft 04 and conversation 07': async (browser) => {
    const { context, page } = await openView(browser, 'chats');
    try {
      const records = await workspaceRecords(context);
      const lead = (n) => records.find((r) => r.id === IDS.lead(n));
      const nameOf = (n) => lead(n).data.name;
      await page.locator('.toolbar').first().waitFor({ timeout: 15000 });
      const shown = new Set();
      for (const tab of ['Новые', 'Просмотренные']) {
        await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
        await page.waitForTimeout(300);
        for (const t of await page.locator('.lead-row .row-title').allTextContents()) shown.add(t.trim());
      }
      const problems = [];
      for (const n of [1, 2, 3]) {
        const l = lead(n);
        const expected = !!l.data.conversationOpen;
        if (shown.has(nameOf(n)) !== expected) problems.push(`lead ${n} «${nameOf(n)}» shown=${shown.has(nameOf(n))} conversationOpen=${expected}`);
      }
      for (const n of [4, 7]) if (!shown.has(nameOf(n))) problems.push(`lead ${n} «${nameOf(n)}» missing`);
      assert(!problems.length, problems.join('; '));
      return `shown: ${JSON.stringify([...shown])}`;
    } finally { await context.close(); }
  },
};

const STAFF = {
  '8 staff-redacted: «Кто лид» save sends no examples, no 403': async (browser) => {
    const { context, page } = await openView(browser, 'ai');
    try {
      await waitAiPage(page);
      await clearLog();
      await editWhoIsLead(page, ' Только с оборотом от миллиона.');
      await saveCard(page);
      await page.waitForTimeout(800);
      const all = await posts();
      const updates = all.filter((p) => p.body.action === 'project_update');
      assert(updates.length >= 1, 'no project_update sent');
      const withExamples = updates.filter((p) => EXAMPLE_KEYS.some((k) => k in (p.body.patch || {})));
      assert(!withExamples.length, `project_update with examples: ${JSON.stringify(withExamples.map((p) => Object.keys(p.body.patch)))}`);
      const denied = all.filter((p) => p.status === 403).map((p) => p.body.action);
      assert(!denied.length && !page.httpErrors.length, `403/4xx: proxy ${JSON.stringify(denied)}, browser ${JSON.stringify(page.httpErrors)}`);
      return `${updates.length} project_update, patch keys ${JSON.stringify(Object.keys(updates[0].body.patch))}; actions ${JSON.stringify(all.map((p) => `${p.body.action}:${p.status}`))}`;
    } finally { await context.close(); }
  },
};

const { chromium } = createRequire(path.join(playwrightProject(), 'package.json'))('@playwright/test');
const { scenario } = await mockLog();
const suite = { full: FULL, 'staff-redacted': STAFF }[scenario];
if (!suite) { console.error(`proxy scenario «${scenario}»: run with --scenario full or staff-redacted`); process.exit(64); }
console.log(`# e2e-ai ${new Date().toISOString()} scenario=${scenario} base=${URL_BASE}`);
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, run] of Object.entries(suite)) {
    try {
      const detail = await run(browser);
      console.log(`PASS ${name} — ${detail}`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${name} — ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
} finally {
  await browser.close();
}
console.log(`# ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
