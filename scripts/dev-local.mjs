#!/usr/bin/env node
/**
 * Локальный one-shot: кабинет (vinext) + Telegram-воркер.
 * Воркер сам поднимается заново при падении — не нужно отдельно npm run tg:worker.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { workerReuseVerdict } from "./dev-worker-reuse.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webPort = Number(process.env.PORT || 5173);
const workerPort = Number(process.env.TG_WORKER_PORT || 8790);
const extraArgs = process.argv.slice(2);

/** Values from .env (not exported to process.env — the apps read .env themselves). */
function readDotEnv() {
  const path = join(root, ".env");
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * The worker refuses to start without TG_WORKER_TOKEN and cron needs CRON_SECRET.
 * Missing ones get a random per-run value shared by web and worker (never written to .env).
 */
function resolveSharedSecrets() {
  const fileEnv = readDotEnv();
  const secrets = {};
  const generated = [];
  let allFromDotEnv = true;
  for (const key of ["TG_WORKER_TOKEN", "CRON_SECRET"]) {
    const value = process.env[key] || fileEnv[key];
    if (!process.env[key] && fileEnv[key]) {
      secrets[key] = value;
      continue;
    }
    allFromDotEnv = false;
    if (value) {
      secrets[key] = value;
    } else {
      secrets[key] = randomBytes(32).toString("hex");
      generated.push(key);
    }
  }
  return { secrets, generated, allFromDotEnv };
}

/** SQLite files hold sealed secrets and PII; keep them owner-only (best-effort). */
function tightenDataFilePerms() {
  const dir = join(root, process.env.DATA_DIR || readDotEnv().DATA_DIR || ".data");
  try {
    for (const name of readdirSync(dir)) {
      if (/\.sqlite/.test(name)) chmodSync(join(dir, name), 0o600);
    }
  } catch {
    /* no data dir yet */
  }
}

const {
  secrets: sharedSecrets,
  generated: generatedSecrets,
  allFromDotEnv,
} = resolveSharedSecrets();
/**
 * The web app runs in Miniflare, which sees only .env unless told to include process env
 * (verified: wrangler getVarsForDev; process env then overrides empty .env values).
 */
const webRuntimeEnv = allFromDotEnv ? {} : { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" };

const children = new Set();
let shuttingDown = false;
let workerRestarts = 0;
let workerBackoffMs = 800;

function log(msg) {
  process.stdout.write(`[dev] ${msg}\n`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function waitPortFree(port, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await portFree(port)) return true;
    if (i === 0) log(`${label}: порт ${port} занят — жду освобождения…`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function spawnLogged(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
    ...opts,
  });
  children.add(child);
  const tag = `[${name}] `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += String(chunk);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) out.write(tag + line + "\n");
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", () => children.delete(child));
  return child;
}

/** "ours" = our worker that accepts this run's token; "stale" = ours with another token. */
async function probeWorker(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${sharedSecrets.TG_WORKER_TOKEN}` },
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return "foreign";
    const j = await res.json().catch(() => ({}));
    if (!String(j?.service || "").includes("tg-worker")) return "foreign";
    return j?.autoRescan ? "ours" : "stale";
  } catch {
    return "foreign";
  }
}

function startWorker() {
  if (shuttingDown) return;
  const script = join(root, "telegram-worker/src/server.mjs");
  if (!existsSync(script)) {
    log("telegram-worker/src/server.mjs не найден — кабинет без Telegram");
    return;
  }
  const py = join(root, "telegram-worker/.venv/bin/python");
  if (!existsSync(py)) {
    log(
      "нет telegram-worker/.venv — воркер может не стартовать. Один раз: cd telegram-worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
    );
  }
  log(`Telegram-воркер → http://127.0.0.1:${workerPort}`);
  const child = spawnLogged("tg", process.execPath, [script], {
    env: {
      ...sharedSecrets,
      TG_WORKER_PORT: String(workerPort),
      APP_URL: process.env.APP_URL || `http://127.0.0.1:${webPort}`,
    },
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    workerRestarts += 1;
    const wait = Math.min(15_000, workerBackoffMs * Math.min(workerRestarts, 8));
    log(
      `воркер упал (code=${code ?? "-"} signal=${signal ?? "-"}) — перезапуск через ${wait}мс (#${workerRestarts})`,
    );
    setTimeout(() => {
      workerBackoffMs = Math.min(8_000, Math.floor(workerBackoffMs * 1.4));
      startWorker();
    }, wait);
  });
  child.on("spawn", () => {
    workerBackoffMs = 800;
  });
}

function startWeb() {
  log(`кабинет → http://127.0.0.1:${webPort}`);
  const runner = join(root, "scripts/run-framework.mjs");
  const child = spawnLogged(
    "web",
    process.execPath,
    [runner, "dev", "--hostname", "127.0.0.1", "--port", String(webPort), ...extraArgs],
    {
      env: {
        ...sharedSecrets,
        ...webRuntimeEnv,
        PORT: String(webPort),
        TELEGRAM_WORKER_URL:
          process.env.TELEGRAM_WORKER_URL || `http://127.0.0.1:${workerPort}`,
      },
    },
  );
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`кабинет остановился (code=${code ?? "-"} signal=${signal ?? "-"})`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("остановка…");
  for (const child of [...children]) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* */
    }
  }
  setTimeout(() => {
    for (const child of [...children]) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
    }
    process.exit(code);
  }, 1500).unref();
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(0));
}

const workerFree = await portFree(workerPort);
let reuseWorker = false;
if (!workerFree) {
  const verdict = workerReuseVerdict(await probeWorker(workerPort), generatedSecrets);
  if (verdict === "reuse") {
    reuseWorker = true;
    log(`Telegram-воркер уже на :${workerPort} — переиспользую (не перезапускаю)`);
  } else if (verdict === "stale") {
    log(
      `на :${workerPort} старый воркер с другими секретами (TG_WORKER_TOKEN/CRON_SECRET) — остановите его или задайте TG_WORKER_TOKEN и CRON_SECRET в .env`,
    );
    process.exit(1);
  } else {
    const okWorker = await waitPortFree(workerPort, "tg-worker");
    if (!okWorker) {
      log(
        `порт ${workerPort} занят чужим процессом — убейте его или смените TG_WORKER_PORT`,
      );
      process.exit(1);
    }
  }
}
const okWeb = await waitPortFree(webPort, "web");
if (!okWeb) {
  log(`порт ${webPort} всё ещё занят — убейте старый npm run dev или смените PORT`);
  process.exit(1);
}

if (generatedSecrets.length) {
  log(`${generatedSecrets.join(", ")} нет в .env — сгенерированы на этот запуск`);
}
tightenDataFilePerms();
if (!reuseWorker) startWorker();
startWeb();
log("готово: один npm run dev, Ctrl+C гасит кабинет" + (reuseWorker ? " (воркер оставлен жить)" : " и воркер"));
