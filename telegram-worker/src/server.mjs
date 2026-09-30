#!/usr/bin/env node
/**
 * Локальный HTTP-воркер Telegram (check / join / scan).
 * Слушает 127.0.0.1 — только localhost; требует TG_WORKER_TOKEN (≥32 символов).
 * Плюс круглосуточный автообход лидов → POST APP_URL/api/cron/auto-rescan (Bearer CRON_SECRET)
 * и тики задач инвайта/рассылки/сбора → POST APP_URL/api/cron/tasks-tick (без открытого кабинета).
 * Guard/runner: worker-app.mjs.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import {
  createCronLoop,
  TASKS_TICK_FETCH_MS,
  createPythonRunner,
  createWorkerServer,
  cronSecretProblem,
  cronTargetAllowed,
  purgeStaleWorkDirs,
  resolveConfig,
} from "./worker-app.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = join(ROOT, "..");
const PY = join(ROOT, ".venv/bin/python");
const SCRIPT = join(__dirname, "check_account.py");
const HOST = "127.0.0.1";

function loadDotEnv() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* .env unreadable — fall back to process env only */
  }
}

/** SQLite files hold sealed secrets and PII; keep them owner-only (best-effort). */
function tightenDataFilePerms() {
  const dir = join(REPO, process.env.DATA_DIR || ".data");
  try {
    for (const name of readdirSync(dir)) {
      if (/\.sqlite/.test(name)) chmodSync(join(dir, name), 0o600);
    }
  } catch {
    /* no data dir yet */
  }
}

loadDotEnv();

let config;
try {
  config = resolveConfig(process.env);
} catch (e) {
  console.error(`[tg-worker] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
const CRON_SECRET_PROBLEM = cronSecretProblem(CRON_SECRET);
/** Как часто дергать cron (сам API режет по autoRescanMinutes на группу). */
const AUTO_RESCAN_EVERY_MS = Math.max(
  60_000,
  Number(process.env.AUTO_RESCAN_EVERY_MS || 5 * 60_000),
);
/** Согласовано с cron TICK_BUDGET 210с + запас. */
const AUTO_RESCAN_FETCH_MS = 270_000;
const BUSY_STALE_MS = 6 * 60_000;

/** Тики задач (инвайт / рассылка / сбор): как часто спрашивать приложение о due-задачах. */
const TASKS_TICK_EVERY_MS = Math.max(
  5_000,
  Number(process.env.TASKS_TICK_EVERY_MS || 20_000),
);
const tasksTickLoop = createCronLoop({
  name: "tasks-tick",
  url: `${APP_URL}/api/cron/tasks-tick`,
  secret: CRON_SECRET,
  // Бюджет прогона на стороне приложения + запас (иначе workerd отменит тики посреди работы).
  fetchMs: TASKS_TICK_FETCH_MS,
  catchUpMs: 3_000,
});

let autoRescanBusy = false;
let autoRescanBusyAt = 0;
let lastAutoRescanAt = "";
let lastAutoRescanResult = null;
let catchUpTimer = null;

function scheduleCatchUp() {
  if (catchUpTimer) return;
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    void tickAutoRescan(false);
  }, 12_000);
}

async function tickAutoRescan(force = false) {
  if (autoRescanBusy) {
    // Не снимаем busy вручную — иначе параллельный fetch. Только catch-up.
    if (Date.now() - autoRescanBusyAt >= BUSY_STALE_MS) {
      console.warn("[auto-rescan] busy долго — ставлю catch-up, не форсю второй тик");
      scheduleCatchUp();
    }
    return { skipped: true, reason: "busy" };
  }
  // Logged once at startup; repeating it every tick would only bury it.
  if (CRON_SECRET_PROBLEM) return { skipped: true, reason: "no_secret" };
  if (!cronTargetAllowed(APP_URL)) {
    console.warn("[auto-rescan] APP_URL не https и не loopback — секрет не отправляю");
    return { skipped: true, reason: "insecure_app_url" };
  }
  autoRescanBusy = true;
  autoRescanBusyAt = Date.now();
  const url = `${APP_URL}/api/cron/auto-rescan${force ? "?force=1" : ""}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(AUTO_RESCAN_FETCH_MS),
    });
    const data = await res.json().catch(() => ({}));
    lastAutoRescanAt = new Date().toISOString();
    lastAutoRescanResult = { status: res.status, ...data };
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.warn("[auto-rescan] fail", res.status, data?.error || data, `${ms}ms`);
    } else if (!data.skipped) {
      console.log(
        `[auto-rescan] scanned=${data.scanned || 0} added=${data.added || 0} joined=${data.joined || 0} due=${data.due || 0} more=${!!data.more} ${ms}ms`,
      );
    }
    if (data?.more && res.ok) scheduleCatchUp();
    return data;
  } catch (e) {
    const ms = Date.now() - t0;
    lastAutoRescanAt = new Date().toISOString();
    lastAutoRescanResult = { ok: false, error: String(e.message || e), ms };
    const abort = /aborted|timeout/i.test(String(e.message || e));
    console.warn(
      abort
        ? `[auto-rescan] timeout ${ms}ms — следующий тик продолжит`
        : `[auto-rescan] error ${e.message || e} ${ms}ms`,
    );
    if (abort) scheduleCatchUp();
    return lastAutoRescanResult;
  } finally {
    autoRescanBusy = false;
  }
}

const runPython = createPythonRunner({ python: PY, script: SCRIPT, cwd: ROOT });

const server = createWorkerServer(config, {
  runPython,
  tickAutoRescan,
  autoRescanStatus: () => ({
    everyMs: AUTO_RESCAN_EVERY_MS,
    fetchMs: AUTO_RESCAN_FETCH_MS,
    appUrl: APP_URL,
    busy: autoRescanBusy,
    lastAt: lastAutoRescanAt,
    last: lastAutoRescanResult,
  }),
});

if (CRON_SECRET_PROBLEM) {
  console.error(
    `[tg-worker] WARNING: ${CRON_SECRET_PROBLEM} (need >= 32 chars, same value as the web app) — auto-rescan and background task ticks are DISABLED until it is set and the worker restarts.`,
  );
}

tightenDataFilePerms();
const purged = await purgeStaleWorkDirs();
if (purged) console.log(`[tg-worker] removed ${purged} stale work dir(s)`);

server.listen(config.port, HOST, () => {
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : config.port;
  console.log(`tg-worker http://${HOST}:${port}`);
  console.log(
    `auto-rescan → ${APP_URL}/api/cron/auto-rescan every ${Math.round(AUTO_RESCAN_EVERY_MS / 60000)}m`,
  );
  // Первый тик через 45с (дать приложению подняться), далее по интервалу
  setTimeout(() => {
    void tickAutoRescan(false);
  }, 45_000);
  setInterval(() => {
    void tickAutoRescan(false);
  }, AUTO_RESCAN_EVERY_MS);
  if (!CRON_SECRET_PROBLEM) {
    console.log(`tasks-tick → ${APP_URL}/api/cron/tasks-tick every ${Math.round(TASKS_TICK_EVERY_MS / 1000)}s`);
  }
  setTimeout(() => {
    void tasksTickLoop.tick();
  }, 30_000);
  setInterval(() => {
    void tasksTickLoop.tick();
  }, TASKS_TICK_EVERY_MS);
});
