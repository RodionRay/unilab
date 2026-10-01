#!/usr/bin/env node
// Interaction states of the AI page (scenario `full`), full-page at 390 / 768 / 1440:
//   funnel-stopwords-open · card-dirty · draft-editing  ->  <out>/<state>-<width>.png
//   leave-dialog (dirty card -> sidebar «Лиды») · project-menu-default (⋯ menu, delete disabled): 390 / 1440 only
//   ONLY=<state,...> env limits the run to those states.
// Usage: node states.mjs [--url http://127.0.0.1:8011] [--out <abs dir>]   (proxy + storage.json must exist, see README)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HARN = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HARN, '../../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const URL_BASE = args.url || 'http://127.0.0.1:8011';
const OUT = args.out || path.join(HARN, '../after/states');
const WIDTHS = [[390, 844], [768, 1024], [1440, 900]];

function playwrightProject() {
  const candidates = [process.env.PW_PROJECT, ROOT, path.join(os.homedir(), '.claude/tools'), path.join(os.homedir(), 'Projects/crm-spa')].filter(Boolean);
  for (const dir of candidates) {
    try { createRequire(path.join(dir, 'package.json')).resolve('@playwright/test'); return dir; } catch { /* next */ }
  }
  throw new Error(`@playwright/test not found in ${candidates.join(', ')}; set PW_PROJECT`);
}

const STATES = {
  'funnel-stopwords-open': async (page) => {
    const row = page.locator('button.aiw-row-main', { hasText: 'Стоп-слова' }).first();
    await row.click();
    await page.locator('.aiw-row[data-open]').first().waitFor();
    await row.scrollIntoViewIfNeeded();
  },
  'card-dirty': async (page) => {
    const field = page.locator('fieldset.aiw-group', { hasText: 'Кто лид' }).locator('textarea').first();
    await field.click();
    await field.press('End');
    await field.pressSequentially(' Отгрузки от 300 единиц в месяц.');
    await page.locator('.aiw-savebar[data-dirty]').waitFor();
  },
  'draft-editing': async (page) => {
    const area = page.locator('.aiw-draft textarea').first();
    await area.click();
    await area.press('End');
    await area.pressSequentially(' Могу созвониться сегодня после 15:00.');
  },
  'leave-dialog': async (page) => {
    await STATES['card-dirty'](page);
    const navLeads = page.locator('button.nav-item', { hasText: 'Лиды' }).first();
    if (!(await navLeads.isVisible())) await page.locator('[data-sidebar="trigger"]').first().click();
    await navLeads.click();
    await page.getByRole('alertdialog', { name: 'Карточка проекта не сохранена' }).waitFor();
  },
  'project-menu-default': async (page) => {
    await page.getByRole('button', { name: 'Действия с проектом' }).first().click();
    await page.getByRole('menuitem', { name: 'Удалить проект' }).waitFor();
  },
};
const ONLY_AT = { 'leave-dialog': [390, 1440], 'project-menu-default': [390, 1440] };

const { chromium } = createRequire(path.join(playwrightProject(), 'package.json'))('@playwright/test');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [width, height] of WIDTHS) {
    for (const [name, act] of Object.entries(STATES)) {
      if (ONLY_AT[name] && !ONLY_AT[name].includes(width)) continue;
      if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) continue;
      const context = await browser.newContext({ viewport: { width, height }, storageState: path.join(HARN, 'storage.json') });
      const page = await context.newPage();
      try {
        await page.goto(`${URL_BASE}/app?view=ai`, { waitUntil: 'networkidle' });
        if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('redirected to login: run login.mjs');
        await page.locator('.aiw-ledger').waitFor({ timeout: 15000 });
        await act(page);
        await page.waitForTimeout(400);
        const file = path.join(OUT, `${name}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log('ok', file);
      } catch (e) {
        failed += 1;
        console.error('FAIL', name, width, e instanceof Error ? e.message : String(e));
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
