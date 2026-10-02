---
status: built — review + verifier done 2026-10-02; stand smoke + real-phone smoke pending (test bot token)
size: full
model: claude-opus-5-5 (effort: session)
budget: 600M tokens
base: dev @671338d + merged locally origin/fix/bot-group-replies-2026-10-01 (contains task/chats-first-contact-tg-bot-2026-10-01) @69c1413
# gate baseline @69c1413: vitest 705/705 · tsc 45 errors · lint 256 problems (237 errors) — red base, must not grow
integration: task/tg-mini-app-2026-10-01
gates: security-reviewer (auth, new route, multi-tenant) · code-reviewer · verifier · /ui-task design panel · e2e
---
# Telegram Mini App — manage the workspace from the phone

Owner ask (RU): «давай сделаем мини апп в боте, для управления проектом». A Telegram Mini App (WebApp) opened from the
workspace's notification bot: triage hot leads / conversations and reply, see account health, start/pause tasks, glance
at stats — without opening the desktop CRM.

Source: read-only scout of origin/dev @671338d + Telegram docs (core.telegram.org/bots/webapps, /bots/api,
/bots/features, /api/links; fetched 2026-10-01). `R` = `app/api/workspace/route.ts`, `AZ` =
`lib/security/workspace-authz.ts`. Locate by symbol, not line.

## Facts the design rests on (verified in code)
- One action-dispatch API: `R::GET` returns all visible records of the owner; `R::POST {action,kind,id,data}`;
  authz `AZ::authorizeWorkspaceAction` + `AZ::ACTION_RULES` (unknown action → denied for members, viewer can't mutate),
  `AZ::visibleRecordsFor`. Actor = `R::readActor` → `lib/auth.ts::getSessionUser` (cookie `uniseller_session`,
  HMAC, 14 d, httpOnly, `SameSite=Lax`) → `lib/staff.ts::resolveWorkspaceContext` (ownerId, role, access).
- Roles `lib/staff-types.ts::STAFF_ROLES` (admin/manager/operator/viewer); access keys `::CRM_ACCESS_KEYS`
  (overview, notifications, leads, chats, groups, audience, invite, mailing, accounts, proxies, ai, settings, staff).
- Bot = per-workspace, user-supplied: `settings.notifyBotToken` + `notifyChatId` (plaintext in the `settings`
  record, blanked for non-owners by `AZ::OWNER_ONLY_SETTINGS_FIELDS`). On dev only `sendMessage`
  (`R::notifyConversationEvent`, `::notifyMailingEvent`, `::notifyNewLeadsTelegram`, `::notifyTelegramText`).
  Unmerged branches add `lib/telegram-bot.ts` (`buildConversationNotice` with «Ответить» callback, `parseBotUpdate`,
  `sendBotMessage`, `chatDeepLink`) and getUpdates polling inside `app/api/cron/tasks-tick/route.ts::listBotOwners`
  (20 s). No webhook (polling and webhook are mutually exclusive).
- `oauth_accounts(provider='telegram', provider_user_id)` exists (Login Widget, `lib/oauth.ts::verifyTelegramAuth`);
  Telegram user ids are global across bots.
- `lib/security/headers.ts::SECURITY_HEADERS` applied to all paths (`next.config.ts::headers`):
  `X-Frame-Options: DENY`, `frame-ancestors 'none'` → would break web.telegram.org / Desktop iframe.
- UI: `app/app/page.tsx` 5355-line client SPA; shadcn new-york + Tailwind 4 (`components/ui/*`, incl. `drawer`,
  `sheet`); `app/globals.css` custom tokens; `components/product/*` panels; no 390 px audit; no DESIGN.md.
- No Playwright, no CI, no Cloudflare deploy/domain. Stand lives in repo `uniseller` worktrees (:5180 / :5280),
  changes ported by hand; a cloudflared quick tunnel to :5280 already runs.

## Telegram facts (cited)
- initData HMAC: `secret = HMAC_SHA256(key="WebAppData", msg=bot_token)`; `hash == hex(HMAC_SHA256(secret,
  data_check_string))`, dcs = all fields except `hash`, sorted, `k=v` joined by `\n` (webapps §Validating).
  `initDataUnsafe` must not be trusted. Ed25519 `signature` path exists for token-less third parties — not needed.
- Launch with initData (user+hash): menu button (`setChatMenuButton`, `MenuButtonWebApp`, per chat or default) and
  inline `web_app` button — **private chats only**. KeyboardButton launch has empty initData. Main Mini App /
  `startapp` links need manual BotFather setup per bot. Only HTTPS URL required; `/setdomain` is Login Widget only.
- SDK `https://telegram.org/js/telegram-web-app.js`; `--tg-theme-*`, `--tg-viewport-stable-height`,
  `--tg-(content-)safe-area-inset-*`; BackButton/MainButton(6.1), showConfirm(6.2), disableVerticalSwipes(7.7),
  SecondaryButton(7.10), safe areas/fullscreen(8.0); gate by `isVersionAtLeast`.
- web.telegram.org = cross-site iframe → `SameSite=Lax` cookie not sent → bearer token, not cookie.

## Design (decided unless the owner overrides — see ledger)
1. **Entry URL** `/tma/<wsKey>` — `wsKey` = random opaque per-workspace key (not ownerId) stored in settings, chooses
   which bot token validates initData. The URL alone grants nothing.
2. **Session exchange** `POST /api/tma/session {wsKey, initData}` → validate HMAC with that workspace's bot token,
   freshness, resolve linked member, return a short-lived bearer (`Authorization: Bearer`, scope `tma`, kept in
   memory only — no cookie, no localStorage).
3. **Actor** — `R::readActor` accepts the tma bearer as an alternative to the cookie; the actor's permissions = the
   member's web role/access ∩ `TMA_ACTIONS` allowlist (no delete, no settings/staff/proxy edits, no bot-token reads).
4. **Linking** (Telegram user → workspace member): verified sources only — (a) `/start link_<code>` in the bot's
   private chat with a single-use code minted from the logged-in web settings; (b) an existing
   `oauth_accounts(provider='telegram')` row for a member of this workspace (Login-Widget-verified). Never link from
   initData alone. On link the bot sets that chat's menu button to the mini app (`setChatMenuButton`, chat_id = user).
5. **Read model** — `GET /api/tma/feed?view=inbox|accounts|tasks|overview` returns small, paginated projections
   (not the full `R::GET` dump), filtered through `AZ::visibleRecordsFor`.
6. **Headers** — `/tma/*` only: drop `X-Frame-Options`, `frame-ancestors https://web.telegram.org
   https://*.telegram.org`; every other path unchanged.
7. **Notices** — private-chat notices (to linked members who opt in) carry an inline `web_app` button that deep-opens
   the lead (`/tma/<wsKey>?lead=<id>`; `#lead=` and `start_param lead_<id>` are also accepted); group notices keep the existing callback «Ответить» (web_app is not allowed in
   groups).

## Requirements (EARS)

### Auth & tenancy (security-critical)
- REQ-A1 When `POST /api/tma/session` receives initData, the system shall verify the HMAC with the bot token of the
  workspace named by `wsKey`, using constant-time comparison, and reject on mismatch with 401 and no detail.
- REQ-A2 If `auth_date` is older than `TMA_INITDATA_MAX_AGE` (default 3600 s) or more than 60 s in the future, the
  system shall reject the exchange with 401.
- REQ-A3 If the workspace has no bot token, an unknown `wsKey`, or the verified `user.id` is not linked to an active
  member of that workspace, the system shall return 403 with a neutral message and the bot's link instructions.
- REQ-A4 The system shall issue a bearer token bound to {userId, ownerId, tgUserId, botId, scope:'tma', exp ≤ 1 h},
  signed with the session secret, and shall not set any cookie.
- REQ-A5 While handling any request with a tma bearer, the system shall re-resolve membership and link state, and shall
  reject if the member was removed, the link revoked, or the workspace bot token changed (botId mismatch).
- REQ-A6 When a tma actor calls an action outside `TMA_ACTIONS` or outside its web role/access, the system shall deny
  it exactly as `AZ::authorizeWorkspaceAction` does for the web.
- REQ-A7 The system shall never return `notifyBotToken`, sealed secrets, session strings or proxy credentials to a
  tma actor, and shall never log initData or bearer tokens.
- REQ-A8 `POST /api/tma/session` and link-code redemption shall be rate-limited per IP and per wsKey
  (`lib/security/rate-limit.ts`). Per wsKey/workspace only failed attempts count (session: failed exchanges,
  `lib/tma/exchange.ts::exchangeWithinWsKeyLimit`; redemption: well-formed failed claims after the per-tg-user limit,
  `lib/tma/links.ts::redeemLinkCode`), so members' own launches and one stranger's junk lock nobody out.
- REQ-A9 Data of workspace A shall never be returned to a session minted for workspace B, including when two
  workspaces share one bot token (link lookup keyed by (ownerId, tgUserId)).

### Linking
- REQ-L1 When a member presses «Подключить Telegram» in web settings, the system shall mint a single-use code (≥128
  bit, base64url ≤ 60 chars, TTL 10 min) and show `t.me/<bot>?start=link_<code>`.
- REQ-L2 When the bot poller receives `/start link_<code>` in a private chat, the system shall bind `from.id` to that
  member (one tg user ↔ one member per workspace), consume the code, reply with confirmation and set the chat's menu
  button to the mini app URL. Mini app URLs (menu button, «Открыть» buttons) come only from a public https `APP_URL`,
  never from the request Host (`lib/tma/bot-link.ts::publicMiniAppUrl`).
- REQ-L3 Where a member already has a Login-Widget `oauth_accounts` telegram row, the system shall accept that tg id
  as linked without a code.
- REQ-L4 When a member (or an admin for them) presses «Отключить», the system shall revoke the link, reset the chat's
  menu button and invalidate live tma tokens (REQ-A5). v1: admin path is server-only (`POST /api/tma/link {action:"unlink",userId}`); the admin button in «Сотрудники» → v1.1 (D-8).
- REQ-L5 Expired, reused or foreign-workspace codes shall be rejected with a bot reply that leaks no workspace data.

### Shell
- REQ-S1 The `/tma/<wsKey>` page shall load the official SDK, call `ready()` and `expand()`, map `--tg-theme-*` onto
  app tokens (light/dark follow Telegram), respect safe-area insets and `--tg-viewport-stable-height`, and render
  without horizontal scroll at 360–430 px.
- REQ-S2 The shell shall use Telegram BackButton for in-app navigation and MainButton for the screen's primary
  action; destructive/irreversible actions shall go through `showConfirm`.
- REQ-S3 If opened outside Telegram (no initData), the page shall show «Откройте из бота» with the bot link, no data.
- REQ-S4 When the bearer expires or returns 401, the shell shall show «Сессия истекла — откройте заново из бота».
- REQ-S5 Every screen shall have loading, empty, error and offline states.

### Screens (MVP — order = build priority)
- REQ-M1 Inbox: hot leads + conversations with unread/new first (leads/chats access), paginated, refresh button.
- REQ-M2 Lead/conversation detail: history, AI draft (`draft`), send reply (`send_lead_message`) via MainButton,
  mark viewed (`mark_lead_viewed`); sending is idempotent per client nonce (double-tap → one message).
- REQ-M3 Accounts: per-account health (status, warm-up cap used/limit, pause/error reason, last check), action
  «Проверить» (`check_account`).
- REQ-M4 Tasks: list mailing / audience / invite / auto-rescan tasks with status + progress; start/pause
  (`start_*`/`pause_*`) with confirm. Auto-rescan is shown read-only (status, last error): on/off is a settings
  save, outside `TMA_ACTIONS`; a narrow toggle action → v1.1 (decision 2026-10-01, `mark_auto_rescan` only logs).
- REQ-M5 Overview: today's key numbers (new leads, replies, messages sent, invites, account errors) from one
  aggregate read.
- REQ-M6 When a private notice's `web_app` button is pressed, the app shall open directly on that lead.

### Notices
- REQ-N1 Where a member is linked and opted in, new-hot-lead / reply notices shall also go to their private chat with
  an inline `web_app` «Открыть» button; group notices are unchanged. They follow the workspace notices switch
  (`noticesOff` in link status) and skip a member whose private chat is the notices chat itself.
- REQ-N2 Notice sending failures (blocked bot, 403) shall disable that member's DM opt-in and be shown in settings.

## Assumptions ledger
| # | Assumption | Source / confidence | If wrong |
|---|---|---|---|
| A1 | Users = all workspace members with their web permissions | DECIDED D1 | — |
| A2 | Bot = the workspace's own notify bot (no platform bot) | code: per-workspace `notifyBotToken`; high | Q? none — platform bot would be a new deployable |
| A3 | Bot-polling branches merged into the integration branch locally | DECIDED (coordinator) | PR supersedes them |
| A4 | Launch via Bot API only (menu button + inline web_app), no BotFather Main Mini App | per-bot manual step doesn't scale; high | add startapp links later |
| A5 | No public prod; testing = stand + HTTPS tunnel + a dedicated test bot | DECIDED D4 | — |
| A6 | MVP excludes settings, staff, proxies, groups CRUD, deletes, AI assistant chat | DECIDED D2 | — |
| A7 | `TMA_INITDATA_MAX_AGE` 1 h, bearer 1 h, reopen to renew | Telegram common practice; medium | config value |
| A8 | Feed endpoints new (`/api/tma/*`), actions reuse `R::POST` handlers | avoid duplicating 5000-line logic; high | — |
| A9 | Bot token stays plaintext in settings (move to sealed `secret` = separate task) | out of scope; flagged risk | security-reviewer may block |
| A10 | Visual language: Telegram theme params + UniLab accent | DECIDED D5 | — |

## Owner decisions (2026-10-01, all = recommended defaults)
- D1 (Q1) All linked staff; permissions = web role/access ∩ `TMA_ACTIONS`. → A1 decided.
- D2 (Q2) MVP = Inbox+reply, Accounts health, Tasks start/pause, Overview; scan-by-link → v1.1. → A6 decided.
- D3 (Q3) Opt-in private DM notices with «Открыть» per member; group notices unchanged.
- D4 (Q4) Stand: quick tunnel + dedicated test bot; `scripts/tma-dev.mjs` re-sets the menu button. → A5 decided.
- D5 (Q5) Telegram theme params + UniLab accent. → A10 decided.
- D6 (orchestrator) Auto-rescan read-only in the mini app; `mark_auto_rescan` removed from `TMA_ACTIONS` (it only logs).

## Milestones / waves (split by file ownership) — as executed
- **W0 done** — bot branches merged locally into `task/tg-mini-app-2026-10-01` (69c1413). The PR must merge after
  (or supersede) `task/chats-first-contact-tg-bot-2026-10-01` + `fix/bot-group-replies-2026-10-01`.
- **Orchestrator** — `lib/tma/contract.ts` (API contract), Playwright devDependency + config, spec/docs.
- **W1 (parallel, local subtask branches → integration branch)**
  - `tma-auth` [backend] — owns `lib/tma/{init-data,session,links,feed,actor}.ts`, `app/api/tma/**`,
    `R::readActor` bearer branch, `AZ` tma allowlist, `drizzle/0002_tma.sql`, `tests/tma-*.test.ts`
    (REQ-A1–A9, L1, L3–L5 server side, M1–M5 reads).
  - `tma-ui` [frontend, ui-builder] — owns `app/tma/**`, `components/tma/**`, `lib/tma/client.ts`,
    `lib/security/headers.ts` + `next.config.ts` exception, `e2e/**`, `playwright.config.ts`
    (REQ-S1–S5, M1–M6 client) against the contract with mocked API.
- **W2 (after tma-auth)**
  - `tma-bot` [backend+settings UI] — owns `lib/telegram-bot.ts` additions, `R::pollBotUpdates`/`handleBotCommand`/
    notify functions, web settings block «Telegram-приложение», `scripts/tma-dev.mjs`, `tests/tma-bot*.test.ts`
    (REQ-L1 UI, L2, L4, N1, N2).
- **W3 integration** — e2e against the real API on a local build, stand port + tunnel smoke, code-reviewer +
  security-reviewer + verifier, docs, ONE PR → dev (body in untracked `.git-pr-body.md`; owner pushes).

## Verification plan
- Unit (vitest): HMAC vectors (valid, tampered field, reordered, wrong token, URL-encoding of `user`), freshness edges
  (exactly max age, future skew), bearer tamper/expiry/scope, botId-rotation invalidation, cross-tenant (two
  workspaces, one bot token, link only in A → B denied), allowlist parity with `ACTION_RULES` per role, link code
  single-use/expiry/foreign workspace, notifyBotToken absent from every tma response (snapshot scan).
- e2e (Playwright — new devDependency, why: repo has none and UI-touching work requires e2e): fixture injects
  `window.Telegram.WebApp` with initData signed by a test token stored in a test workspace (`DB_DATABASE`
  isolated); flows: open → inbox → lead → send reply (one message on double-tap) → back; accounts check; task pause
  with confirm; expired token → reopen screen; outside Telegram → stub screen. Viewports 360/390/430, light + dark
  theme params. `ui-qa` + design panel on every screenshot.
- Stand: port to the running uniseller stand; `cloudflared tunnel --url http://127.0.0.1:<stand port>`;
  `scripts/tma-dev.mjs` sets the dedicated **test bot** menu button to `<tunnel>/tma/<wsKey>`; real-phone smoke on
  iOS + Android + Telegram Desktop/web.telegram.org (iframe → headers exception), with webview inspector. Evidence
  = screenshots + network log (no initData in logs). Do not reuse the bot shared by the two existing stands.
- Gates: lint/tsc must not grow over red baseline, vitest green, build green; security-reviewer findings = blockers;
  verifier tries to refute REQ-A*/L* first.

## Security notes (for security-reviewer)
- Trust root = HMAC with the workspace bot token. Anyone holding that token can forge initData for any tg id →
  impersonate linked members via the mini app. Mitigations: token owner-only + never returned (REQ-A7), tma allowlist
  excludes destructive/admin actions (A6), botId binding (A5); recommended follow-up: move token to sealed `secret`.
- Replay of leaked initData limited by freshness (A2) + short bearer; no cookie → no CSRF surface; bearer only in
  memory.
- `/tma/*` iframe allowance limited to telegram origins; API routes keep `frame-ancestors 'none'`.
- `R::POST` Origin check stays; tma requests come from our own origin.

## Risks
- R1 PR carries the unmerged bot branches (W0) — merge order matters; polling-only bot (a webhook would conflict).
- R2 Monolith `R` (5000 lines): bearer branch in `readActor` touches every action — needs the allowlist test matrix.
- R3 No public HTTPS: quick-tunnel hostname churn; the menu button URL must be re-set on each restart.
- R4 Group-based notices can't carry web_app buttons → value depends on members DMing the bot (Q3).
- R5 Plaintext bot token = trust root (A9).
- R6 Stand is a separate repo with manual porting → drift between tested and merged code.
- R7 Red baseline (tsc/lint) and no CI → gate is local only.
