---
status: approved (plan review APPROVE_WITH_CHANGES 2026-10-01, amendments AM-1..17 binding)
size: full
type: feature
model: claude-opus-5-5 (effort: session)
budget: 600M tokens
base: dev @671338d
integration: task/vk-lead-source-2026-10-01
---
# VK as a lead source (read-only, M1)

`R` = app/api/workspace/route.ts, `P` = app/app/page.tsx. Locate by symbol, not line.

## Goal
A workspace with a VK token gets VK leads (public posts, comments, group discussions) scored by the same
core + AI pipeline as Telegram, in the same Leads view and Telegram notifications, with no duplicate leads.

## Non-goals (M1)
- Sending anything to VK (comment replies, DMs) → M2 after a live antispam/limits check on a real account.
- VK ID OAuth connect; MAX / YouTube / other platforms; VK audience/invite/mailing tasks.
- Landing copy (`app/page.tsx:131`) — separate `/site` task if wanted.

## Clarifications (owner, 2026-10-01)
- Scope: BOTH global keyword search (`newsfeed.search`) AND added niche groups (wall posts + comments + board topics).
- Replies: search only in M1; the lead card links to the post/comment in VK, the owner replies by hand.
- Token: pasted manually by the user, stored sealed like Telegram sessions; spike checks which methods it allows.
- Accounts (owner, 2026-10-01): mostly bought on a marketplace and added in bulk → bulk import, proxy per account,
  rotation across the account pool (like the Telegram farm).

## Context — existing, DO NOT recreate
- Storage: `db/schema.ts::records` (owner, kind, data JSON, secret sealed); `lib/server-store.ts::seal/unseal`.
- Settings: `R` settings zod (`keywords`, `autoRescanMinutes`, `scanDepthDays`, AI brief, notify bot).
- Scoring: `lib/lead-core.ts::scoreLead`, `workerKeywordsFromSettings`; `lib/processes/scan-flow.ts::decideScanLead`,
  `applyAiVerdicts`; `lib/processes/lead-ai.ts::qualifyLeadsWithAi` (DeepSeek via `lib/ai-client.ts::aiChatText`); `R::rememberAiRejects`; seam `lib/processes/lead-ingest.ts::pickLeads` (T1).
- Dedup: `lib/lead-filter.ts::leadMessageFingerprint(message, groupId, tgMsgId)`, tombstones, `excludeFromTraining`.
- Lead insert + group metrics: `R` action `scan_group` (insert `INSERT INTO records … 'lead'`); lock `R::acquireGroupScanLock`.
- Notify: `R::flushLeadNotifications` (Telegram Bot API, `notifyPending`).
- Cron: `/api/cron/auto-rescan` (Bearer `CRON_SECRET`), driven by `telegram-worker/src/server.mjs`.
- UI: `P` leads filter `leadGroupFilter`; views from `components/product/workspace-nav.tsx::NavName`.
- Identity: `lib/record-identity.ts` (`canonicalizeTgUrl`, `duplicateReason`). VK OAuth login only: `lib/oauth.ts`.

## Design decisions
- D1 Transport in the Python worker, logic in TS: bought accounts need their own proxy, and Cloudflare workerd `fetch`
  cannot use SOCKS/HTTP proxies. New worker endpoint `/vk-call` (`telegram-worker/src/vk_api.py`, urllib +
  PySocks `sockshandler`, already pinned) runs a batch of VK calls through the account's proxy; parsing, keys,
  limits, scoring stay in `lib/vk/*` (TS).
- D2 New record kinds `vk_account` (token in `secret`) and `vk_source` (`type: 'search' | 'group'`, cursor state)
  so Telegram pickers/limits (`lib/telegram-accounts.ts`) never see VK rows. Leads stay kind `lead` with
  `platform: 'vk'`; a missing `platform` means `'telegram'` (no data migration).
- D3 Shared ingest: extract "candidates → prefilter → dedup → AI → insert → notify-flag" from `scan_group` into one
  function used by both platforms (refactor with Telegram behaviour unchanged, proven by existing tests).
- D4 VK dedup key is platform-wide, not per source: `vk:<owner_id>_<post_id>` / `vk:<owner_id>_<post_id>_c<comment_id>`
  / `vk:board<group_id>_<topic_id>_<comment_id>`, so search and group scans never duplicate one item.

## Acceptance criteria
- REQ-1 WHEN the user pastes a list of VK accounts (one per line: `token` or `login:password:token`, the marketplace
  format; password is discarded, never stored; the last part counts as the token only in a token shape — `vk1.a.…` or
  85+ token characters — otherwise the line is invalid and nothing from it is sent to VK) THE SYSTEM SHALL validate each token (`users.get`) through its proxy,
  store it only sealed in `records.secret`, skip duplicates (same `vkUserId`), and report per line
  added / duplicate / invalid with the reason; the token is never returned to the client.
- REQ-1a WHEN accounts are imported THE SYSTEM SHALL bind each to a proxy (chosen proxy, or round-robin over active
  `proxy` records, ≤ N accounts per proxy, default 3); IF no active proxy is available THEN the account is saved
  `no_proxy` and is not used for scans.
- REQ-1b WHEN a VK source is scanned THE SYSTEM SHALL pick an active account from the pool (least used today,
  not in cooldown) and fail over to the next one on errors 5/6/9/14/29 within the same run.
- REQ-2 IF the token is invalid/expired (VK error 5) THEN THE SYSTEM SHALL mark that `vk_account` `error` with the
  reason, exclude it from the pool, and show the state in the Accounts view; scans stop only when no active account is left.
- REQ-3 WHEN a VK scan runs in `search` mode THE SYSTEM SHALL query `newsfeed.search` for each strong keyword from
  settings, posts not older than `scanDepthDays`, in the interval [stored `searchStartTime` − 5 min, pinned end time],
  following `next_from` → `start_from` up to 3 pages per keyword per run; unfinished keywords continue next run from
  their stored `next_from` in the same interval, and `searchStartTime` moves to the interval end only when every
  keyword has finished paging.
- REQ-4 WHEN the user adds a VK group (URL `vk.com/<screen_name>` / `club<id>` / `public<id>`) THE SYSTEM SHALL resolve
  it (`utils.resolveScreenName` / `groups.getById`), reject duplicates (canonical id), and on scan read new wall posts,
  their comments and board-topic comments since the cursor, within `scanDepthDays`.
- REQ-5 WHEN VK items are fetched THE SYSTEM SHALL pass them through the same prefilter, minus-terms, `scoreLead`,
  AI qualification and AI-reject memory as Telegram, and create `lead` records with `platform:'vk'`, author name,
  text, source title, deep link URL, `temperature`, `reason`.
- REQ-6 THE SYSTEM SHALL never create two leads for one VK item (D4 key), across search and group sources,
  repeated scans and concurrent cron + manual runs (per-source lock).
- REQ-7 WHEN a VK lead is created THE SYSTEM SHALL notify through the existing Telegram notify bot with a `VK` mark
  and the deep link.
- REQ-8 WHEN `auto-rescan` cron fires THE SYSTEM SHALL also scan due VK sources (`autoRescanMinutes` throttle), within
  the existing time budget (`more:true` on overflow).
- REQ-9 IF VK returns rate-limit/flood/captcha (errors 6, 9, 14, 29) THEN THE SYSTEM SHALL back off that account
  (cooldown until a computed time), keep the cursor unchanged, and never mark the source `error`.
- REQ-10 THE SYSTEM SHALL send ≤3 VK requests/s per token and ≤ a configurable daily cap of `newsfeed.search` calls
  (default 500), reset at Moscow midnight like Telegram counters.
- REQ-11 (UI) Leads view SHALL show a platform badge (Telegram/VK), a platform filter (all/Telegram/VK) next to the
  group filter, and «Открыть в VK» on VK leads instead of the send controls; Telegram leads look unchanged.
- REQ-12 (UI) Accounts view SHALL have a VK section (bulk import textarea with per-line result, proxy binding, status,
  last error, today's usage, bulk delete); Groups view SHALL list
  VK sources (search source auto-created on first token; groups added by URL) with last scan time and error.
  States: empty / loading / error / success; 390 / 768 / 1440.
- REQ-13 Existing Telegram leads/scan behaviour SHALL be unchanged: the full existing vitest + Python suites stay green.

## Contracts
- `vk_account.data`: `{ vkUserId, name, proxyId, status: 'active'|'error'|'cooldown'|'no_proxy', error?, cooldownUntil?,
  counters:{day, calls, searchCalls}, searchBlockedUntil?: Record<method, iso>, leaseId?, leaseUntil?, tokenFp, expiresIn }`;
  `secret`: sealed token. `tokenFp` (8-byte SHA-256 of owner+token) and `leaseId` are server-internal and stripped
  from the GET projection (`lib/security/workspace-authz.ts::VK_ACCOUNT_INTERNAL_FIELDS`); `expiresIn` 0 = offline token.
- Worker `POST /vk-call` (Bearer `TG_WORKER_TOKEN`): `{ token, proxy, calls:[{method, params}] }` → `{ results:[{ok, response?, error:{code,msg}?}] }`; ≤25 calls per request, 3 rps pacing inside.
- `vk_source.data`: `{ type, title, vkGroupId?, screenName?, cursor:{ searchStartTime?, searchPaging?:{endTime, next:{keyword: next_from}},
  wallMaxPostId?, boardSince? }, lastScanAt, scanLockUntil, error?, aiRejected[], leadTombstones[] }`.
- `vk_tombstones` (one server-only row per owner, never listed to the client): `{ leadTombstones[] }` — keys of deleted
  VK leads whose source is gone; deleting a source moves its tombstones here (AM-2).
- `lead.data` additions: `platform`, `msgKey` (D4), `url`, `vkSourceId`; Telegram leads keep `tgMsgId`.
- `R` actions: `vk_accounts_import`, `vk_account_delete`, `vk_account_set_proxy`, `vk_source_add`, `vk_source_delete`, `scan_vk_source`,
  `vk_source_ensure_search` (idempotent, access as `vk_source_add`: `{}` → `{ok, id, created, source}` where `source` = `vk_source.data`);
  read actions extend the existing workspace list payload; `rescan_groups` adds `vkSourceIds` (≤3 due ids) and `vkTotal`.

## NFRs
- VK API version pinned (`v=5.199`), timeout 15 s per call, retries only on network/5xx (max 2).
- A scan of one source = ≤45 s of VK calls + ≤60 items to AI, inside the cron's 150 s per-scan timeout, or yields
  `more:true`; no unbounded loops (page cap per run).
- Token never logged; errors logged with VK error code only.

## Assumptions
| id | assumption | evidence | if wrong → | conf |
|---|---|---|---|---|
| A-1 | A user token can call `newsfeed.search`, `wall.get`, `wall.getComments`, `board.getTopics/getComments` | VK API docs | spike S0 finds the minimal token scopes or drops a mode | med |
| A-2 | Marketplace accounts come as `login:password:token` with a long-lived (offline) token | typical marketplace format | add a cookie/password auth flow in M2 | med |
| A-6 | Bought accounts get banned faster for read-only API use without a proxy | Telegram farm experience | — (proxy is mandatory) | med |
| A-3 | `newsfeed.search` daily cap ≈ 1000 per token | community reports, not official | lower the default cap | low |
| A-4 | VK leads need no reply flow in M1 | owner answer | — | high |
| A-5 | A live token for S0 comes from the owner's VK account | owner said GO | S0 runs on recorded fixtures, live check = HUMAN_NEEDED | med |

## Plan
Milestone M1 = read-only VK leads. Risks first.

- **S0 spike (wave 0)** — `lib/vk/client.ts` minimal + script `scripts/vk-spike.mjs`: call each method with a real
  token, record sanitised responses to `tests/fixtures/vk/*.json`, document limits/errors in this spec (Surprises).
  Verify: script prints method → ok/error code. Owns: `lib/vk/`, `scripts/vk-spike.mjs`, `tests/fixtures/vk/`.
- **T1 ingest seam (wave 1)** — pure `lib/processes/lead-ingest.ts::pickLeads({items:[{key,message,name,date}],
  coreSettings, seen, aiRejects, depthCutoff, qualify})` → `{kept, rejectedIds, funnel}`; move `R::qualifyLeadsWithAi`
  verbatim to `lib/processes/lead-ai.ts` (pure-move edit in `R`). Switching `scan_group` to `pickLeads` only if Telegram
  tests stay unchanged. REQ-5, REQ-13. Verify: new unit tests + `npm test` green. Owns: `lib/processes/lead-*`, the move in `R`.
- **T2 VK transport + client + pool (wave 1, [P] with T1)** — worker `vk_api.py` + `/vk-call` route (proxy, pacing,
  error passthrough; Python unittest with a stub server); `lib/vk/client.ts` (version, error mapping, injected `post(path,body,ms)`; T3 wires `workerPost`),
  `lib/vk/pool.ts` (account pick, failover, daily caps, cooldown), `lib/vk/import.ts` (line parser), `lib/vk/parse.ts`
  (post/comment/board → candidate + D4 key + deep link), `lib/vk/url.ts`. REQ-1 (parse), 1a, 1b, 9, 10.
  Verify: unit tests on fixtures. Owns: `lib/vk/*`, `telegram-worker/src/vk_api.py`, `worker-app.mjs::ROUTES['/vk-call']` + timeout, `check_account.py::run_action` `vk_call` branch, `tests/vk-*`, `telegram-worker/tests/test_vk_api.py`.
- **T3 VK scan + storage + cron (wave 2)** — record kinds, `R` VK actions, `scan_vk_source` via T1 ingest, notify mark,
  auto-rescan loop. REQ-1..8. Verify: route-level tests with `tests/helpers/workspace-harness.ts` + mocked `fetch`
  (search + group, rerun = 0 new leads, concurrent run = 1 lead, error 5/6/14 paths). Owns: `R` VK actions, cron route.
- **T4 UI (wave 3)** — via `/ui-task` (reuse existing components): Accounts VK section, Groups VK sources, Leads badge +
  filter + «Открыть в VK». REQ-11, REQ-12. Verify: ui-qa at 390/768/1440 + e2e on the local stand. Owns: `P`, `components/product/*`.
- **Gate (integrated)** — `npm run lint` (must not grow vs base), `npm test`, `npm run build`, Python unittest;
  `code-reviewer` + `security-reviewer` (token storage, new routes) + `verifier`; port to the local stand; live
  check with the owner's token.

Dependency: S0 → T2 fixtures; T1 ∥ T2 → T3 → T4.

## Plan review amendments (2026-10-01, binding; override text above on conflict)
- AM-1 REQ-6: lead `id` = UUID-shaped hash(owner+msgKey) (version nibble set), insert `INSERT OR IGNORE`, count `meta.changes`.
- AM-2 New REQ-14: deleting a VK lead tombstones its `msgKey` on its `vk_source`; ingest `seen` = union of all owner's vk_source tombstones; `R::rememberDeletedLead` VK branch.
- AM-3 New REQ-15: lead zod + `scan-flow.ts::SERVER_OWNED.lead` gain `platform,msgKey,url,vkSourceId`; vk_source server-owned fields; `message` truncated to 8000 at ingest.
- AM-4 `vk_account`/`vk_source` never in generic `kindSchema` save; actions handled before `kindSchema.parse`; proxy delete guard checks `vk_account.proxyId`.
- AM-5 T1 = seam (`pickLeads` + verbatim move); `lib/lead-filter.ts` untouched (VK dedup = `msgKey` equality).
- AM-6 T2 owns `check_account.py::run_action` branch + `ROUTES['/vk-call']`; client gets injected `post`.
- AM-7 `/vk-call`: hard 45 s deadline in Python (unrun calls → `{code:-1,msg:'deadline'}`, retries count), host fixed `api.vk.com`, reuse `make_proxy`/`resolve_public_host`.
- AM-8 REQ-9 by code: 6 → pause+retry same token; 9/14 → account cooldown (14: 60 min, no captcha solving); 29 → `searchBlockedUntil` next Moscow midnight for that method; 5/17/18 → account `error`, no proxy rotation; 15/30/203/212 → skip item/source, no failover.
- AM-9 REQ-1b: one live scan per account (lease on `vk_account`).
- AM-10 REQ-1: import in chunks ≤20 lines/request (UI loops); parser also accepts `oauth.vk.com/blank.html#access_token=…&user_id=…`; store `expires_in`, warn if ≠0.
- AM-11 REQ-1a: per-proxy cap counts Telegram + VK accounts.
- AM-12 REQ-8: `rescan_groups` also returns ≤3 due `vkSourceIds`; `tickOwner` interleaves, VK `SCAN_TIMEOUT` 60 s, threshold `left()≥70s`.
- AM-13 REQ-5: AI-reject memory + metrics on `vk_source`, keyed by `msgKey`, filtered by `vkSourceId`.
- AM-14 REQ-7: `notifyNewLeadsTelegram` input gains `platform,url`; line `[VK] … · <source>\n<url>` (T3).
- AM-15 REQ-3: `extended=1`; community posts (`from_id<0`) named by `signer_id` else group name.
- AM-16 A-3 evidence = dev.vk.com limits ≈1000/day (S0 confirms); A-7: tokens may be IP-bound → one fixed proxy per account.
- AM-17 S0 records `groups.getById` 5.199 shape and whether `execute` is allowed (if yes, T2 may batch comments).

## Verification plan
REQ-1..10, 13 → vitest (route + unit, fixtures from S0). REQ-11, 12 → ui-qa screenshots + e2e on stand.
Live VK (real token, ≥1 real lead from search and from a group) → stand, evidence = lead record + screenshot.

## Decision log
- 2026-10-01 separate kinds, platform-wide dedup key (D2–D4).
- 2026-10-01 D1 revised: bulk bought accounts need per-account proxy; workerd fetch has no proxy → transport in the Python worker.

- 2026-10-01 T2 choices: 29-block per method `searchBlockedUntil: Record<method,iso>`; error 9 → 30 min cooldown; worker
  code -5 = proxy rejected → 15 min cooldown; unknown VK codes → `skip_item`; chosen-but-full proxy → `no_proxy` (no fallback);
  `vk_api.py` allows proxy-less calls, the pool refuses proxy-less accounts.
- 2026-10-01 T1: whole-`qualify` throw now falls back to core (was scan error); in-batch duplicate tgMsgId dropped before AI.
- 2026-10-01 T3 choices: modules `lib/vk/{records,session,fetch}.ts` + `lib/processes/{vk-scan,vk-accounts,scan-queue}.ts`,
  `R` only dispatches (`R::vkScanDeps`, `R::vkAccountDeps`). Import: no proxy → saved `no_proxy` WITHOUT a VK call
  (A-7, token may be IP-bound), validated on `vk_account_set_proxy`; slots are planned before validation, so an
  invalid token holds a slot only inside its own chunk; re-pasted unvalidated tokens found by `tokenFp`
  (8-byte SHA-256 of owner+token, in data). Search: first 8 strong keywords (`strongPlusTerms`), one 200-post page each,
  `start_time = max(depth, cursor − 300 s)`; daily search cap is checked at account pick, so one run may exceed it by
  ≤7 calls. Group: wall page 100 (posts filtered by `wallMaxPostId`), comments of the 10 newest posts in depth
  (re-read every run, dedup by key), board topics updated since `boardSince` (5 per run). Failover: ≤3 accounts per
  run; a run sends new batches for 45 s. Lead id = SHA-256(owner+msgKey) shaped as UUID v5. Source state written
  with `json_set` (tombstones written meanwhile survive). Deleting a source moves its tombstones to another source;
  its leads stay. Settings gain `vkSearchDailyCap` (500) and `vkAccountsPerProxy` (3). Cron: groups and VK sources
  alternate (`interleaveScans`); `rescan_groups` lists no VK source while no account can scan.

- 2026-10-02 REQ-3 paging (review fix): `cursor.searchPaging = {endTime, next:{keyword: next_from}}` pins the interval
  (`end_time`) while any keyword pages; ≤3 pages per keyword per run (≤24 search calls a run); a keyword added while an
  interval pages joins the next interval; nothing answered (all calls failover-worthy) → cursor unchanged.
  Board topics: read oldest-updated first, ≤5 per run, page 100, `boardSince` = newest topic actually read (>100 topics
  updated between two runs, or >5 sharing one `updated` second, are a known gap).

- 2026-10-02 review fixes (supersede AM-12's 60 s / 70 s): cron VK scan timeout = Telegram `SCAN_TIMEOUT_MS` 150 s,
  started only with ≥120 s of tick left; a VK timeout stops the remaining VK sources of that tick, Telegram groups go on.
  ≤60 items go to AI per run (`lib/processes/vk-scan.ts::VK_AI_ITEMS_PER_RUN`), the rest stay undecided and the cursor is
  kept so the next run meets them again (`more:true`). A search source without strong keywords gets `lastScanAt` +
  error «Нет ключевых слов» before any account lease and is not due until keywords exist. Tombstones of a deleted source
  (or of a lead whose source is gone) go to the owner-level `vk_tombstones` row instead of another source.

REQ → tests (T3): REQ-1/1a/AM-10/11 `tests/vk-accounts-route.test.ts` «REQ-1 bulk import»; REQ-4 «REQ-4 group sources»;
REQ-3/5/6/7/14/15, REQ-2/9/AM-8, REQ-1b/10/AM-9 `tests/vk-scan-route.test.ts`; REQ-8 `tests/vk-cron.test.ts` + «REQ-8 rescan_groups».

## Surprises
- (S0 fills this)

## Progress
- 2026-10-01 spec clarified; worktree `~/worktrees/wt-unilab-vk-lead-source`.
- 2026-10-01 wave 1 merged locally (gh not authenticated → no subtask PRs): T1 0a4c414, T2 7b3b0a6; vitest 769/769, lint 258 / tsc 45 unchanged vs base.
- 2026-10-01 T3 (scan, storage, cron) on the integration branch 451e13c..723a8f3; vitest 817/817.
- 2026-10-01 security review fixes merged 3d5560f (server-owned lead fields, json_set key allowlist, read-only VK methods
  in /vk-call, tokenFp/leaseId hidden from GET).
- 2026-10-02 T4 UI merged 4e1f4c7 (Accounts VK section, Groups VK sources, Leads badge/filter/«Открыть в VK»).
- 2026-10-02 code-review fixes on `task/vk-lead-source-2026-10-01-fixsrv` (worktree `~/worktrees/wt-unilab-vk-fixsrv`):
  AI cap + 150 s cron timeout, board cursor, no-keywords source, search paging, tombstone holder, `vk_source_ensure_search`,
  `artifacts/` untracked; vitest 886/886, lint 258 / tsc 45 unchanged, build ok, Python 82/82. Live VK NOT verified.
