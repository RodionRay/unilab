/**
 * HTTP guard, config and Python runner for the local Telegram worker.
 * Entry point: server.mjs. Split out so the security invariants are unit-testable.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual, createHash } from "node:crypto";
import { mkdtemp, chmod, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WORK_DIR_PREFIX = "uniseller-acc-";
export const MIN_TOKEN_LENGTH = 32;
const DEFAULT_MAX_BODY_BYTES = 6_000_000;
const DEFAULT_MAX_CONCURRENCY = 4;
// Requests beyond the running slots wait here; the UI fires ~8 proxy checks at once.
const DEFAULT_MAX_QUEUE = 64;
const DEFAULT_MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 5_000;
// After SIGKILL the kernel reaps the child almost at once; this only bounds a missing 'close'.
const STOP_FALLBACK_MARGIN_MS = 1_000;
const GENERIC_WORKER_ERROR = "Ошибка воркера (нет ответа)";
const TIMEOUT_ERROR = "Таймаут воркера";
const ABORTED_ERROR = "Запрос отменён клиентом";

export const ROUTES = Object.freeze({
  "/check-account": "check",
  "/check-proxy": "check_proxy",
  "/join-group": "join",
  "/scan-group": "scan",
  "/collect-audience": "collect",
  "/invite-users": "invite",
  "/send-message": "send",
  "/inbox-dms": "inbox",
  "/update-profile": "update_profile",
  "/upload-photo": "upload_photo",
});

const LONG_ACTIONS = new Set(["upload_photo", "collect", "invite"]);

/** @param {string} action */
export function timeoutForAction(action) {
  if (action === "check") return 28_000;
  if (action === "check_proxy") return 18_000;
  return LONG_ACTIONS.has(action) ? 180_000 : 120_000;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function resolveConfig(env) {
  const token = env.TG_WORKER_TOKEN || "";
  if (!token) {
    throw new Error("TG_WORKER_TOKEN is required (refusing to start an unauthenticated worker)");
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`TG_WORKER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  const extraHosts = String(env.TG_WORKER_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    token,
    port: Number(env.TG_WORKER_PORT || 8790),
    extraHosts,
    maxConcurrency: positiveInt(env.TG_WORKER_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY),
    maxQueue: nonNegativeInt(env.TG_WORKER_MAX_QUEUE, DEFAULT_MAX_QUEUE),
    maxBodyBytes: positiveInt(env.TG_WORKER_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
  };
}

/** @param {string | undefined} raw @param {number} fallback */
function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** @param {string | undefined} raw @param {number} fallback */
function nonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Constant-time Bearer check. Hashing both sides equalises lengths for timingSafeEqual.
 * @param {string | undefined} header
 * @param {string} token
 */
export function tokenMatches(header, token) {
  if (!header || !token) return false;
  const digest = (/** @type {string} */ s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}

/**
 * Why auto-rescan cannot run with this CRON_SECRET, or null when it can.
 * The app rejects secrets shorter than MIN_TOKEN_LENGTH, so those are unusable too.
 * @param {string | undefined} secret
 */
export function cronSecretProblem(secret) {
  if (!secret) return "CRON_SECRET is not set";
  if (secret.length < MIN_TOKEN_LENGTH) {
    return `CRON_SECRET is shorter than ${MIN_TOKEN_LENGTH} characters`;
  }
  return null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The cron call carries CRON_SECRET, so it must never travel over plain HTTP off-host.
 * @param {string} appUrl
 */
export function cronTargetAllowed(appUrl) {
  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * One cron endpoint polled in a loop (e.g. /api/cron/tasks-tick): never two calls in
 * flight, Bearer CRON_SECRET only to https/loopback, a quick catch-up run when the
 * app answers `more:true` or the call timed out.
 * @param {{ name: string, url: string, secret: string, fetchMs: number, catchUpMs: number,
 *   fetchImpl?: typeof fetch, schedule?: (fn: () => void, ms: number) => unknown,
 *   log?: Pick<Console, "log" | "warn"> }} opts
 */
export function createCronLoop(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const schedule = opts.schedule ?? setTimeout;
  const log = opts.log ?? console;
  const problem = cronSecretProblem(opts.secret);
  let busy = false;
  let catchUpPending = false;
  /** @type {{ at: string, result: unknown }} */
  const last = { at: "", result: null };

  const catchUp = () => {
    if (catchUpPending) return;
    catchUpPending = true;
    schedule(() => {
      catchUpPending = false;
      void tick();
    }, opts.catchUpMs);
  };

  async function tick() {
    if (busy) return { skipped: true, reason: "busy" };
    if (problem) return { skipped: true, reason: "no_secret" };
    if (!cronTargetAllowed(opts.url)) return { skipped: true, reason: "insecure_app_url" };
    busy = true;
    const t0 = Date.now();
    try {
      const res = await fetchImpl(opts.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/json" },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(opts.fetchMs),
      });
      const data = await res.json().catch(() => ({}));
      last.at = new Date().toISOString();
      last.result = { status: res.status, ...data };
      if (!res.ok) log.warn(`[${opts.name}] fail`, res.status, data?.error || "", `${Date.now() - t0}ms`);
      if (res.ok && data?.more) catchUp();
      return data;
    } catch (e) {
      const msg = String(/** @type {Error} */ (e)?.message || e);
      last.at = new Date().toISOString();
      last.result = { ok: false, error: msg };
      const abort = /aborted|timeout/i.test(msg);
      log.warn(abort ? `[${opts.name}] timeout — next run continues` : `[${opts.name}] error ${msg}`);
      if (abort) catchUp();
      return last.result;
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    status: () => ({ url: opts.url, busy, lastAt: last.at, last: last.result }),
  };
}

/**
 * Remove work dirs left behind by a crashed worker (they may hold plaintext sessions).
 * @param {{ dir?: string, maxAgeMs?: number, now?: number }} [opts]
 */
export async function purgeStaleWorkDirs(opts = {}) {
  const dir = opts.dir || tmpdir();
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now();
  let removed = 0;
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(WORK_DIR_PREFIX)) continue;
    const path = join(dir, name);
    try {
      const st = await stat(path);
      if (now - st.mtimeMs < maxAgeMs) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* raced with another cleaner — nothing to do */
    }
  }
  return removed;
}

/**
 * Extract the exception class name from a Python traceback for logs, never the message.
 * @param {string} stderr
 */
function exceptionType(stderr) {
  const lines = stderr.trim().split("\n");
  const last = lines[lines.length - 1] || "";
  const m = last.match(/^([A-Za-z_][\w.]*)(?::|$)/);
  return m ? m[1] : "unknown";
}

/**
 * @param {{ python: string, script: string, cwd?: string, tmpRoot?: string,
 *   killGraceMs?: number, maxStdoutBytes?: number, env?: NodeJS.ProcessEnv }} opts
 */
export function createPythonRunner(opts) {
  const tmpRoot = opts.tmpRoot || tmpdir();
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxStdoutBytes = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  /** @type {Set<Promise<void>>} */
  const pending = new Set();

  /**
   * @param {unknown} payload
   * @param {number} timeoutMs
   * @param {AbortSignal} [signal] aborted when the HTTP client went away
   * @returns {Promise<Record<string, unknown>>}
   */
  async function run(payload, timeoutMs, signal) {
    if (signal?.aborted) return { ok: false, status: "disconnected", error: ABORTED_ERROR };
    const workDir = await mkdtemp(join(tmpRoot, WORK_DIR_PREFIX));
    await chmod(workDir, 0o700);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (/** @type {Record<string, unknown>} */ value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const child = spawn(opts.python, [opts.script, "--payload", "-", "--work-dir", workDir], {
        cwd: opts.cwd,
        env: { ...(opts.env || process.env), PYTHONUNBUFFERED: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      /** @type {Buffer[]} */
      const outChunks = [];
      let outBytes = 0;
      let errTail = "";
      /** @type {NodeJS.Timeout | undefined} */
      let killTimer;
      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      };
      /** Result to report once a stopped child is gone; null while it runs normally. */
      /** @type {Record<string, unknown> | null} */
      let stopResult = null;
      /** @type {NodeJS.Timeout | undefined} */
      let stopFallback;
      /**
       * Kills the child and answers only when it has exited ('close'), so the caller's
       * slot is not freed while Python still runs. The fallback covers a killed child
       * whose pipes stay open (e.g. an orphaned grandchild holding stdout).
       * @param {string} error
       */
      const stop = (error) => {
        if (settled || stopResult) return;
        stopResult = { ok: false, status: "disconnected", error };
        terminate();
        const result = stopResult;
        stopFallback = setTimeout(() => finish(result), killGraceMs + STOP_FALLBACK_MARGIN_MS);
      };
      const timer = setTimeout(() => stop(TIMEOUT_ERROR), timeoutMs);
      const onAbort = () => stop(ABORTED_ERROR);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      child.stdout.on("data", (/** @type {Buffer} */ d) => {
        outBytes += d.length;
        if (outBytes > maxStdoutBytes) {
          stop(GENERIC_WORKER_ERROR);
          return;
        }
        outChunks.push(d);
      });
      child.stderr.on("data", (/** @type {Buffer} */ d) => {
        errTail = (errTail + d.toString()).slice(-4096);
      });
      const closed = new Promise((done) => {
        child.on("close", () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (killTimer) clearTimeout(killTimer);
          if (stopFallback) clearTimeout(stopFallback);
          rm(workDir, { recursive: true, force: true })
            .catch(() => console.warn("[tg-worker] failed to remove work dir"))
            .finally(() => done(undefined));
          if (settled) return;
          if (stopResult) return finish(stopResult);
          const line = Buffer.concat(outChunks).toString("utf8").trim().split("\n").filter(Boolean).pop() || "";
          try {
            finish(JSON.parse(line));
          } catch {
            console.warn(`[tg-worker] python produced no JSON (${exceptionType(errTail)})`);
            finish({ ok: false, status: "disconnected", error: GENERIC_WORKER_ERROR });
          }
        });
      });
      const tracked = closed.then(() => {
        pending.delete(tracked);
      });
      pending.add(tracked);
      child.on("error", () => {
        console.warn("[tg-worker] failed to spawn python");
        finish({ ok: false, status: "disconnected", error: GENERIC_WORKER_ERROR });
      });
      child.stdin.on("error", () => {
        /* child exited before reading stdin — handled by close */
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  /** Resolves when every spawned child has exited and its work dir is gone. */
  run.idle = async () => {
    while (pending.size) await Promise.all([...pending]);
  };
  return run;
}

/** @param {string | undefined} contentType */
function isJson(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{ runPython: (payload: any, timeoutMs: number, signal?: AbortSignal) => Promise<unknown>,
 *   tickAutoRescan: (force: boolean) => Promise<unknown>,
 *   autoRescanStatus: () => Record<string, unknown> }} deps
 */
export function createWorkerServer(config, deps) {
  // Requests holding a place: reading their body, waiting for a slot or running.
  // Reserved before the body is read, so slow senders cannot all pass the check.
  let admitted = 0;
  let active = 0;
  /** @type {Array<() => void>} */
  const waiters = [];
  /**
   * Resolves true once a Python slot is held (FIFO), false if `signal` aborts first.
   * @param {AbortSignal} signal
   * @returns {Promise<boolean>}
   */
  const acquire = (signal) => {
    if (signal.aborted) return Promise.resolve(false);
    if (active < config.maxConcurrency) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        const i = waiters.indexOf(grant);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      };
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiters.push(grant);
    });
  };
  /** Hands the slot to the next waiter, or frees it. Call once per granted slot. */
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  /** @param {import("node:http").IncomingMessage} req */
  const hostAllowed = (req) => {
    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : config.port;
    const host = String(req.headers.host || "").toLowerCase();
    return (
      host === `127.0.0.1:${port}` ||
      host === `localhost:${port}` ||
      config.extraHosts.includes(host)
    );
  };

  const server = createServer(async (req, res) => {
    const send = (/** @type {number} */ code, /** @type {unknown} */ data, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...extra });
      res.end(JSON.stringify(data));
    };
    if (!hostAllowed(req)) return send(403, { error: "Forbidden" });
    const authed = tokenMatches(req.headers.authorization, config.token);

    if (req.method === "GET" && req.url === "/health") {
      const base = { ok: true, service: "uniseller-tg-worker" };
      return send(200, authed ? { ...base, autoRescan: deps.autoRescanStatus() } : base);
    }
    const action = req.method === "POST" ? ROUTES[/** @type {keyof typeof ROUTES} */ (req.url)] : undefined;
    const isRescan = req.method === "POST" && req.url === "/auto-rescan-now";
    if (!action && !isRescan) return send(404, { error: "not found" });
    if (!authed) return send(401, { error: "Unauthorized" });
    if (!isJson(req.headers["content-type"])) return send(415, { error: "Content-Type must be application/json" });
    if (isRescan) return send(200, await deps.tickAutoRescan(true));

    const declared = Number(req.headers["content-length"] || 0);
    if (declared > config.maxBodyBytes) {
      req.resume();
      return send(413, { ok: false, error: "Payload too large" }, { Connection: "close" });
    }
    if (admitted >= config.maxConcurrency + config.maxQueue) {
      req.resume();
      return send(429, { ok: false, error: "Воркер занят, повторите позже" }, { "Retry-After": "5" });
    }
    admitted += 1;
    let placeHeld = true;
    const leave = () => {
      if (!placeHeld) return;
      placeHeld = false;
      admitted -= 1;
    };
    // Client gone before we answered (e.g. app-side timeout): stop waiting / kill the job.
    const clientGone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) clientGone.abort();
      leave();
    });
    try {
      await handleJob(req, send, action, clientGone.signal);
    } finally {
      leave();
    }
  });

  /**
   * Reads the body (before queueing, so a waiting request can't hit requestTimeout),
   * then runs the job in a Python slot.
   * @param {import("node:http").IncomingMessage} req
   * @param {(code: number, data: unknown, extra?: Record<string, string>) => void} send
   * @param {string} action
   * @param {AbortSignal} signal
   */
  async function handleJob(req, send, action, signal) {
    let payload;
    try {
      const raw = await readBody(req, config.maxBodyBytes);
      if (raw === null) return send(413, { ok: false, error: "Payload too large" }, { Connection: "close" });
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(400, { ok: false, error: "Invalid JSON" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return send(400, { ok: false, error: "Invalid JSON" });
    }
    payload.action = action;
    if (!(await acquire(signal))) return;
    try {
      if (signal.aborted) return;
      return send(200, await deps.runPython(payload, timeoutForAction(action), signal));
    } catch {
      return send(500, { ok: false, error: GENERIC_WORKER_ERROR });
    } finally {
      release();
    }
  }
  // Slow senders must not pin a concurrency slot while the body trickles in.
  server.requestTimeout = 60_000;
  return server;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer | null>} null when the body exceeds the limit
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (/** @type {Buffer} */ c) => {
      if (overflow) return;
      size += c.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    let ended = false;
    req.on("end", () => {
      ended = true;
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on("close", () => {
      if (!ended && !overflow) reject(new Error("client aborted"));
    });
    req.on("error", reject);
  });
}
