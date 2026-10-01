# Uniseller Leads

Private administration workspace for Telegram sources and sales leads.

## Implemented
- D1 persistence, per-user server authorization, same-origin mutations.
- CRUD accounts, proxies, groups and manually entered leads.
- Proxy import, account/proxy assignment, dependency validation on removal.
- AES-GCM encrypted proxy passwords and OpenAI API keys.
- OpenAI Responses API draft generation and manual editing/copying.
- Russian responsive UI inspired by Air on Refero Styles.

## Not implemented yet
Telegram authorization / tdata import, joining groups, proxy connectivity checks, background message collection, automatic lead qualification and Telegram sending. These require a separate long-running Telegram connector; Sites has no raw TCP support. UI labels these limitations.

## Development
1. Copy `.env.example` to `.env` and set secrets:
   - `ENCRYPTION_KEY` — 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `SESSION_SECRET` — at least 32 random chars
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` — hash via `npm run auth:hash -- 'your-password'` (colon-separated `pbkdf2:...`, no `$`)
2. `npm run install:ci`
3. `npm run build`
4. Apply D1 migration once (local wrangler state):
   `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0000_even_hydra.sql`
5. One command for кабинет + Telegram-воркер:
   `npm run dev`
   (воркер сам перезапускается при падении; отдельно `tg:worker` не нужен)
   Только UI без воркера: `npm run dev:web`
6. Open http://localhost:5173/login

### Telegram worker (`telegram-worker/`)
- Python deps: `cd telegram-worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (versions pinned from the working venv). The venv runs **Python 3.9, which is end-of-life since October 2025** — no security fixes; migration to 3.12+ is pending (not done yet).
- `telegram-worker/src/server.mjs` refuses to start without `TG_WORKER_TOKEN` (≥32 chars); the web app sends it as `Authorization: Bearer …`. Requests must use `Host: 127.0.0.1:<port>` or `localhost:<port>` (extra hosts: `TG_WORKER_ALLOWED_HOSTS`, comma-separated) and `Content-Type: application/json`. `/health` returns only `{ok, service}` without the token.
- Limits: `TG_WORKER_MAX_CONCURRENCY` (default 4, excess → 429), `TG_WORKER_MAX_BODY_BYTES` (default 6000000 → 413), Python stdout 2 MB, account archives ≤5000 files / ≤200 MB unpacked. Proxy hosts resolving to loopback/private/link-local/CGNAT/multicast addresses are rejected.
- Session archives are unpacked into a `0700` temp dir `uniseller-acc-*` created and always removed by Node (timeout → SIGTERM, SIGKILL after 5 s); stale dirs older than 10 minutes are purged on start.
- Auto-rescan cron: the worker calls `APP_URL/api/cron/auto-rescan` with `Authorization: Bearer $CRON_SECRET` only if `APP_URL` is https or loopback. `CRON_SECRET` (≥32 chars, same value in the web app and the worker) is **required** for auto-rescan: without it the worker logs one warning at startup and skips every tick.
- Task runner cron: the worker also calls `APP_URL/api/cron/tasks-tick` (same `CRON_SECRET` guard) every `TASKS_TICK_EVERY_MS` (default 20000, min 5000); it ticks due `running`/`scheduled` invite, mailing and audience tasks of every owner, so tasks keep running with the browser closed and scheduled ones resume at `nextAt`. Only owners that are existing users (or the admin) get a session. A tick starts a worker call only while it fits the tick wall budget (300 s, `lib/processes/tick-budget.ts`) and otherwise commits its progress and continues next run; the runner never aborts a tick call earlier than the worst-case tick (`TASKS_TICK_CALL_TIMEOUT_MS`), and the worker's fetch timeout (`TASKS_TICK_FETCH_MS`) is above the run budget — workerd cancels a handler whose caller disconnected. One tick per task at a time (atomic `tickLockUntil`/`tickLockId` lock, `lib/processes/tick-lock.ts`).
- Both cron routes call `/api/workspace` on `APP_URL` (set it in the web app env too), else on `127.0.0.1:<request port>` — never on the request Host header (`lib/security/self-origin.ts::selfOrigin`).
- `npm run dev`: if `TG_WORKER_TOKEN` / `CRON_SECRET` are absent from env and `.env`, random per-run values are generated and passed to both processes (not written to `.env`).
- Tests: `npx vitest run tests/tg-worker-server.test.ts`; Python guards: `telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests`.

### Client IP and rate limits
- Per-IP limits (`login-ip`, `register-ip`, `contact-ip`, `assistant-anon-ip` in `lib/security/rate-limit.ts::RATE_LIMITS`) key on the header named by `TRUSTED_IP_HEADER` (`lib/security/client-ip.ts::trustedClientIp`), default `cf-connecting-ip`.
- The reverse proxy in front of the app **must overwrite** that header with the real client IP (Cloudflare does this for `cf-connecting-ip`). Without such a proxy (local dev, Docker/VPS via `wrangler dev --local` — miniflare passes a client-supplied `CF-Connecting-IP` through) the header is spoofable: set `TRUSTED_IP_HEADER=none` (or empty), or point it at the header your proxy overwrites (e.g. `x-real-ip`).
- Signed-in assistant use is capped per user per day: `ASSISTANT_USER_DAILY_LIMIT` (default 200; `lib/security/rate-limit.ts::assistantUserDailyRule`), then 429 with `Retry-After`.
- Docker (`Dockerfile`, `docker-compose.yml`) ships `TRUSTED_IP_HEADER=none`. To enable per-IP limits, put a reverse proxy in front that overwrites a header with the real client IP (nginx: `proxy_set_header X-Real-IP $remote_addr;`) and set `TRUSTED_IP_HEADER=x-real-ip` in `.env` (compose passes it through).
- With no trusted IP the per-IP buckets are skipped (not shared under one key, which would let one client lock everyone out); per-email, per-user and global limits still apply.

Runtime DB is Cloudflare D1 (local file under `.wrangler/state`). `better-sqlite3` is only for optional Node scripts (`npm run db:migrate`).

## Not implemented yet
Telegram authorization / tdata import, joining groups, proxy connectivity checks, background message collection, automatic lead qualification and Telegram sending. These require a separate long-running Telegram connector; Sites has no raw TCP support. UI labels these limitations.

## Validation
Build and TypeScript pass. Local HTTP checks cover authentication, origin rejection, input validation, secret redaction, CRUD, references and missing AI configuration. Live Telegram and OpenAI calls have not been tested.

Motion references: Fade Slide Tabs by Ruixen UI and Animate Digits by unlumen on 21st.dev. Admin visual language inspired by Spike (WrapPixel): Plus Jakarta Sans, `#0085db`, light paper cards on `#F0F5F9`.

