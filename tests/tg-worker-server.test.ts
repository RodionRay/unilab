import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {
  createPythonRunner,
  createWorkerServer,
  cronSecretProblem,
  cronTargetAllowed,
  purgeStaleWorkDirs,
  resolveConfig,
  tokenMatches,
} from '../telegram-worker/src/worker-app.mjs';

const TOKEN = 'a'.repeat(64);
const SERVER_ENTRY = join(__dirname, '../telegram-worker/src/server.mjs');

let scratch = '';
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tgw-test-'));
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

async function listen(opts: {maxConcurrency?: number; maxQueue?: number; runPython?: (p: unknown, t: number, s?: AbortSignal) => Promise<unknown>} = {}) {
  const config = resolveConfig({
    TG_WORKER_TOKEN: TOKEN,
    TG_WORKER_PORT: '0',
    TG_WORKER_MAX_CONCURRENCY: String(opts.maxConcurrency ?? 4),
    TG_WORKER_MAX_QUEUE: opts.maxQueue === undefined ? undefined : String(opts.maxQueue),
  });
  const server = createWorkerServer(config, {
    runPython: opts.runPython ?? (async () => ({ok: true})),
    tickAutoRescan: async () => ({skipped: true}),
    autoRescanStatus: () => ({appUrl: 'http://127.0.0.1:5173', busy: false}),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return {port, base: `http://127.0.0.1:${port}`};
}

function post(base: string, path: string, init: {token?: string; host?: string; contentType?: string; body?: string} = {}) {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
  if (init.contentType !== undefined) headers['Content-Type'] = init.contentType;
  if (init.host) headers.Host = init.host;
  return rawRequest(base, path, 'POST', headers, init.body ?? '{}');
}

// fetch() forbids overriding Host, so use node:http directly.
async function rawRequest(base: string, path: string, method: string, headers: Record<string, string>, body?: string) {
  const {request} = await import('node:http');
  const url = new URL(path, base);
  return new Promise<{status: number; json: Record<string, unknown>}>((resolve, reject) => {
    const req = request({host: url.hostname, port: url.port, path: url.pathname, method, headers}, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({status: res.statusCode ?? 0, json: data ? JSON.parse(data) : {}}));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('tg-worker config', () => {
  it('refuses a missing or short TG_WORKER_TOKEN', () => {
    expect(() => resolveConfig({})).toThrow(/TG_WORKER_TOKEN/);
    expect(() => resolveConfig({TG_WORKER_TOKEN: 'short'})).toThrow(/32/);
    expect(resolveConfig({TG_WORKER_TOKEN: TOKEN}).token).toBe(TOKEN);
  });

  it('process exits non-zero when started without a token', async () => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {...process.env, TG_WORKER_TOKEN: '', TG_WORKER_PORT: '0', CRON_SECRET: ''},
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    expect(code).not.toBe(0);
  });

  it('flags a missing or short CRON_SECRET', () => {
    expect(cronSecretProblem('')).toMatch(/CRON_SECRET/);
    expect(cronSecretProblem(undefined)).toMatch(/CRON_SECRET/);
    expect(cronSecretProblem('x'.repeat(31))).toMatch(/32/);
    expect(cronSecretProblem('x'.repeat(32))).toBeNull();
  });

  it('warns once at startup when CRON_SECRET is missing', async () => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {...process.env, TG_WORKER_TOKEN: TOKEN, TG_WORKER_PORT: '0', CRON_SECRET: ''},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (c) => String(c).includes('tg-worker http') && resolve());
      child.on('exit', (code) => reject(new Error(`exited ${code}: ${stderr}`)));
    });
    child.kill();
    expect(stderr.match(/CRON_SECRET/g)?.length).toBe(1);
    expect(stderr).toMatch(/auto-rescan/);
  });

  it('compares tokens exactly', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it('sends cron only to https or loopback APP_URL', () => {
    expect(cronTargetAllowed('https://app.example.com')).toBe(true);
    expect(cronTargetAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(cronTargetAllowed('http://localhost:5173')).toBe(true);
    expect(cronTargetAllowed('http://[::1]:5173')).toBe(true);
    expect(cronTargetAllowed('http://app.example.com')).toBe(false);
    expect(cronTargetAllowed('not a url')).toBe(false);
  });
});

describe('tg-worker HTTP guard', () => {
  it('rejects a wrong token with 401', async () => {
    const {base} = await listen();
    const res = await post(base, '/check-proxy', {token: 'b'.repeat(64), contentType: 'application/json'});
    expect(res.status).toBe(401);
  });

  it('rejects a foreign Host header with 403 (DNS rebinding)', async () => {
    const {base, port} = await listen();
    const res = await post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json', host: `evil.example:${port}`});
    expect(res.status).toBe(403);
  });

  it('rejects a non-JSON Content-Type with 415', async () => {
    const {base} = await listen();
    const res = await post(base, '/check-proxy', {token: TOKEN, contentType: 'text/plain'});
    expect(res.status).toBe(415);
  });

  it('accepts a valid request on localhost Host', async () => {
    const {base, port} = await listen();
    const res = await post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json; charset=utf-8', host: `localhost:${port}`});
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
  });

  it('returns 404 for the removed audience/invite routes and never runs python', async () => {
    let calls = 0;
    const {base, port} = await listen({runPython: async () => { calls += 1; return {ok: true}; }});
    for (const path of ['/collect-audience', '/invite-users']) {
      const res = await post(base, path, {token: TOKEN, contentType: 'application/json', host: `localhost:${port}`});
      expect(res.status).toBe(404);
    }
    expect(calls).toBe(0);
  });

  it('hides autoRescan details on /health unless authed', async () => {
    const {base} = await listen();
    const anon = await rawRequest(base, '/health', 'GET', {});
    expect(anon.status).toBe(200);
    expect(anon.json).toEqual({ok: true, service: 'uniseller-tg-worker'});
    const authed = await rawRequest(base, '/health', 'GET', {Authorization: `Bearer ${TOKEN}`});
    expect(authed.json.autoRescan).toBeDefined();
  });

  it('returns 413 for an oversized body', async () => {
    // Declare a huge body but send only a few bytes: the server must refuse on the
    // declared length alone. Streaming 7 MB raced the server's Connection: close
    // and failed with EPIPE/ECONNRESET before the 413 could be read.
    const {port} = await listen();
    const {request} = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/check-proxy',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': '7000000',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on('error', reject);
      req.write('{"x":"');
    });
    expect(status).toBe(413);
  });

  it('queues requests beyond the slots and returns 429 only when the queue is full', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const {base} = await listen({maxConcurrency: 1, maxQueue: 1, runPython: async () => {await gate; return {ok: true};}});
    const first = post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    await new Promise((r) => setTimeout(r, 100));
    const queued = post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    await new Promise((r) => setTimeout(r, 100));
    const rejected = await post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    expect(rejected.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect((await queued).status).toBe(200);
  });

  it('serves 8 concurrent proxy checks with 4 slots (UI bulk check) without 429', async () => {
    let running = 0;
    let peak = 0;
    const {base} = await listen({
      maxConcurrency: 4,
      runPython: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 50));
        running -= 1;
        return {ok: true};
      },
    });
    const results = await Promise.all(
      Array.from({length: 8}, () => post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'})),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(peak).toBe(4);
  });
});

describe('tg-worker queue admission and aborts', () => {
  // Headers arrive at once, bodies later: admission must be decided (and reserved) per request.
  function slowBodyPost(port: number, delayMs: number) {
    return new Promise<number | string>(async (resolve) => {
      const {request} = await import('node:http');
      const req = request(
        {host: '127.0.0.1', port, path: '/check-proxy', method: 'POST',
          headers: {Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': '2'}},
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => resolve(`err:${e.code}`));
      req.flushHeaders();
      setTimeout(() => req.end('{}'), delayMs);
    });
  }

  function abortedPost(port: number) {
    return import('node:http').then(({request}) => {
      const req = request({host: '127.0.0.1', port, path: '/check-proxy', method: 'POST',
        headers: {Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json'}});
      req.on('error', () => {});
      req.end('{}');
      return req;
    });
  }

  it('reserves queue places before reading bodies, so a slow-body flood gets 429', async () => {
    let started = 0;
    const {port} = await listen({maxConcurrency: 1, maxQueue: 1, runPython: async () => {
      started += 1;
      await new Promise((r) => setTimeout(r, 100));
      return {ok: true};
    }});
    const codes = await Promise.all(Array.from({length: 10}, () => slowBodyPost(port, 100)));
    expect(codes.filter((c) => c === 200)).toHaveLength(2);
    expect(codes.filter((c) => c === 429)).toHaveLength(8);
    expect(started).toBe(2);
  });

  it('drops a queued request whose client went away and frees its place', async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const {base, port} = await listen({maxConcurrency: 1, maxQueue: 1, runPython: async () => {
      started += 1;
      if (started === 1) await gate;
      return {ok: true};
    }});
    const first = post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    await new Promise((r) => setTimeout(r, 50));
    const gone = await abortedPost(port);
    await new Promise((r) => setTimeout(r, 50));
    gone.destroy();
    await new Promise((r) => setTimeout(r, 50));
    // The aborted request no longer holds the only queue place.
    const next = post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect((await first).status).toBe(200);
    expect((await next).status).toBe(200);
    expect(started).toBe(2);
  });

  it('signals the running job when its client goes away', async () => {
    let signal: AbortSignal | undefined;
    const {port, base} = await listen({maxConcurrency: 1, runPython: (_p, _t, s) => {
      if (signal) return Promise.resolve({ok: true});
      signal = s as AbortSignal;
      return new Promise((resolve) => s?.addEventListener('abort', () => resolve({ok: false})));
    }});
    const gone = await abortedPost(port);
    await new Promise((r) => setTimeout(r, 50));
    gone.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(signal?.aborted).toBe(true);
    // Slot came back exactly once: the next request runs.
    const res = await post(base, '/check-proxy', {token: TOKEN, contentType: 'application/json'});
    expect(res.status).toBe(200);
  });
});

describe('tg-worker python runner', () => {
  function fakeScript(name: string, body: string) {
    const path = join(scratch, name);
    writeFileSync(path, body);
    return path;
  }

  it('removes the work dir after a timeout even if the child ignores SIGTERM', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const script = fakeScript('sleeper.mjs', `
      const i = process.argv.indexOf('--work-dir');
      const fs = await import('node:fs');
      fs.writeFileSync(process.argv[i + 1] + '/account.session', 'secret');
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 200});
    const result = await run({action: 'check'}, 300);
    expect(result).toMatchObject({ok: false, status: 'disconnected'});
    await run.idle();
    expect(readdirSync(tmpRoot).filter((n) => n.startsWith('uniseller-acc-'))).toEqual([]);
  });

  it('returns a generic error without stderr when the child prints no JSON', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const script = fakeScript('crash.mjs', `process.stderr.write('Traceback: secret /Users/x/path ValueError: boom\\n'); process.exit(1);`);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 200});
    const result = (await run({action: 'check'}, 5000)) as {error: string};
    expect(result.error).not.toMatch(/secret|Traceback|\/Users/);
    await run.idle();
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  function pidAlive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it.each(['timeout', 'abort'] as const)('answers only after a SIGTERM-ignoring child is gone (%s)', async (how) => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const pidFile = join(scratch, `pid-${how}`);
    const script = fakeScript(`stubborn-${how}.mjs`, `
      (await import('node:fs')).writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 400});
    const ac = new AbortController();
    const pending = run({action: 'check'}, how === 'timeout' ? 300 : 60_000, ac.signal);
    if (how === 'abort') setTimeout(() => ac.abort(), 300);
    expect(await pending).toMatchObject({ok: false, status: 'disconnected'});
    expect(pidAlive(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
    await run.idle();
  });

  it('still answers when a killed child cannot close its pipes', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const pidFile = join(scratch, 'pid-grandchild');
    // The grandchild inherits stdout, so 'close' never fires after the child is killed.
    const script = fakeScript('orphaner.mjs', `
      const {spawn} = await import('node:child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit', detached: true});
      (await import('node:fs')).writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 200});
    const t0 = Date.now();
    try {
      expect(await run({action: 'check'}, 300)).toMatchObject({ok: false, status: 'disconnected'});
      expect(Date.now() - t0).toBeLessThan(3_000);
    } finally {
      process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
      await run.idle();
    }
  });

  it('kills the child and skips spawning when the job is aborted', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const script = fakeScript('long.mjs', `setInterval(() => {}, 1000);`);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 200});
    const ac = new AbortController();
    const t0 = Date.now();
    const pending = run({action: 'check'}, 60_000, ac.signal);
    setTimeout(() => ac.abort(), 200);
    expect(await pending).toMatchObject({ok: false, status: 'disconnected'});
    await run.idle();
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(readdirSync(tmpRoot)).toEqual([]);

    const done = new AbortController();
    done.abort();
    expect(await run({action: 'check'}, 60_000, done.signal)).toMatchObject({ok: false});
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('kills a child whose stdout exceeds the cap', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const script = fakeScript('flood.mjs', `const s = 'x'.repeat(65536); const w = () => process.stdout.write(s, w); w();`);
    const run = createPythonRunner({python: process.execPath, script, tmpRoot, killGraceMs: 200, maxStdoutBytes: 256 * 1024});
    const result = (await run({action: 'check'}, 10_000)) as {ok: boolean};
    expect(result.ok).toBe(false);
  });

  it('purges only stale uniseller-acc-* dirs', async () => {
    const tmpRoot = mkdtempSync(join(scratch, 'root-'));
    const stale = join(tmpRoot, 'uniseller-acc-old');
    const fresh = join(tmpRoot, 'uniseller-acc-new');
    const other = join(tmpRoot, 'other-old');
    for (const d of [stale, fresh, other]) mkdirSync(d);
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(stale, old, old);
    utimesSync(other, old, old);
    await purgeStaleWorkDirs({dir: tmpRoot, maxAgeMs: 10 * 60_000});
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
