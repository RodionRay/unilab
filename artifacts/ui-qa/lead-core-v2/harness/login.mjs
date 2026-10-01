#!/usr/bin/env node
// Logs in through the mock proxy and saves Playwright storageState to storage.json (gitignored).
// Usage: node login.mjs [--url http://127.0.0.1:8011] [--out <abs storage.json>]
// Playwright: resolved from $PW_PROJECT, the worktree, ~/.claude/tools, then ~/Projects/crm-spa.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HARN = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HARN, '../../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const URL_BASE = args.url || 'http://127.0.0.1:8011';
const OUT = args.out || path.join(HARN, 'storage.json');

export function playwrightProject() {
  const candidates = [process.env.PW_PROJECT, ROOT, path.join(os.homedir(), '.claude/tools'), path.join(os.homedir(), 'Projects/crm-spa')].filter(Boolean);
  for (const dir of candidates) {
    try { createRequire(path.join(dir, 'package.json')).resolve('@playwright/test'); return dir; } catch { /* next */ }
  }
  throw new Error(`@playwright/test not found in ${candidates.join(', ')}; set PW_PROJECT`);
}

const PROJECT = playwrightProject();
const { chromium } = createRequire(path.join(PROJECT, 'package.json'))('@playwright/test');
const creds = JSON.parse(readFileSync(path.join(HARN, '.run/credentials.json'), 'utf8'));

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${URL_BASE}/login`);
  await page.locator('input[type="email"], input[name="email"]').first().fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }),
    page.locator('form button[type="submit"]').first().click(),
  ]);
  const check = await context.request.get(`${URL_BASE}/api/workspace`);
  if (check.status() === 401) throw new Error(`login failed: GET /api/workspace -> ${check.status()}`);
  await context.storageState({ path: OUT });
  console.log(`logged in, storage -> ${OUT} (playwright from ${PROJECT})`);
} finally {
  await browser.close();
}
