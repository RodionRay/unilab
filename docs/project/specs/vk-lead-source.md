---
status: clarified (owner answers 2026-10-01; plan review pending)
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

## Context — existing, DO NOT recreate
- Storage: `db/schema.ts::records` (owner, kind, data JSON, secret sealed); `lib/server-store.ts::seal/unseal`.
- Settings: `R` settings zod (`keywords`, `autoRescanMinutes`, `scanDepthDays`, AI brief, notify bot).
- Scoring: `lib/lead-core.ts::scoreLead`, `workerKeywordsFromSettings`; `lib/processes/scan-flow.ts::decideScanLead`,
  `applyAiVerdicts`; `R::qualifyLeadsWithAi` (DeepSeek via `lib/ai-client.ts::aiChatText`); `R::rememberAiRejects`.
- Dedup: `lib/lead-filter.ts::leadMessageFingerprint(message, groupId, tgMsgId)`, tombstones, `excludeFromTraining`.
- Lead insert + group metrics: `R` action `scan_group` (insert `INSERT INTO records … 'lead'`); lock `R::acquireGroupScanLock`.
- Notify: `R::flushLeadNotifications` (Telegram Bot API, `notifyPending`).
- Cron: `/api/cron/auto-rescan` (Bearer `CRON_SECRET`), driven by `telegram-worker/src/server.mjs`.
- UI: `P` leads filter `leadGroupFilter`; views from `components/product/workspace-nav.tsx::NavName`.
- Identity: `lib/record-identity.ts` (`canonicalizeTgUrl`, `duplicateReason`). VK OAuth login only: `lib/oauth.ts`.

## Design decisions
- D1 VK client in TypeScript inside the web app (`lib/vk/*`): VK API is plain HTTPS, no Telethon-style session;
  the Python worker stays Telegram-only.
- D2 New record kinds `vk_account` (token in `secret`) and `vk_source` (`type: 'search' | 'group'`, cursor state)
  so Telegram pickers/limits (`lib/telegram-accounts.ts`) never see VK rows. Leads stay kind `lead` with
  `platform: 'vk'`; a missing `platform` means `'telegram'` (no data migration).
- D3 Shared ingest: extract "candidates → prefilter → dedup → AI → insert → notify-flag" from `scan_group` into one
  function used by both platforms (refactor with Telegram behaviour unchanged, proven by existing tests).
- D4 VK dedup key is platform-wide, not per source: `vk:<owner_id>_<post_id>` / `vk:<owner_id>_<post_id>_c<comment_id>`
  / `vk:board<group_id>_<topic_id>_<comment_id>`, so search and group scans never duplicate one item.

## Acceptance criteria
- REQ-1 WHEN the user saves a VK token THE SYSTEM SHALL validate it (`users.get`), store it only sealed in
  `records.secret`, show the VK name/id, and never return the token to the client.
- REQ-2 IF the token is invalid/expired (VK error 5) THEN THE SYSTEM SHALL mark the `vk_account` `error` with the
  reason, stop VK scans for the workspace, and show the state in the Accounts view.
- REQ-3 WHEN a VK scan runs in `search` mode THE SYSTEM SHALL query `newsfeed.search` for each strong keyword from
  settings, posts not older than `scanDepthDays`, continuing from the stored cursor (`start_time`/`start_from`).
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
- REQ-12 (UI) Accounts view SHALL have a VK section (add token, status, last error, delete); Groups view SHALL list
  VK sources (search source auto-created on first token; groups added by URL) with last scan time and error.
  States: empty / loading / error / success; 390 / 768 / 1440.
- REQ-13 Existing Telegram leads/scan behaviour SHALL be unchanged: the full existing vitest + Python suites stay green.

## Contracts
- `vk_account.data`: `{ vkUserId, name, status: 'active'|'error'|'cooldown', error?, cooldownUntil?, counters:{day, searchCalls} }`; `secret`: sealed token.
- `vk_source.data`: `{ type, title, vkGroupId?, screenName?, cursor:{ searchStartTime?, wallMaxPostId?, boardSince? }, lastScanAt, scanLockUntil, error?, aiRejected[], leadTombstones[] }`.
- `lead.data` additions: `platform`, `msgKey` (D4), `url`, `vkSourceId`; Telegram leads keep `tgMsgId`.
- `R` actions: `vk_account_save`, `vk_account_delete`, `vk_source_add`, `vk_source_delete`, `scan_vk_source`; read
  actions extend the existing workspace list payload.

## NFRs
- VK API version pinned (`v=5.199`), timeout 15 s per call, retries only on network/5xx (max 2).
- A scan of one source ≤ 60 s or yields `more:true`; no unbounded loops (page cap per run).
- Token never logged; errors logged with VK error code only.

## Assumptions
| id | assumption | evidence | if wrong → | conf |
|---|---|---|---|---|
| A-1 | A user token can call `newsfeed.search`, `wall.get`, `wall.getComments`, `board.getTopics/getComments` | VK API docs | spike S0 finds the minimal token scopes or drops a mode | med |
| A-2 | Cloudflare workerd `fetch` reaches `api.vk.com` from the stand/prod | the app already calls DeepSeek/Telegram via fetch | move the client into the worker | high |
| A-3 | `newsfeed.search` daily cap ≈ 1000 per token | community reports, not official | lower the default cap | low |
| A-4 | VK leads need no reply flow in M1 | owner answer | — | high |
| A-5 | A live token for S0 comes from the owner's VK account | owner said GO | S0 runs on recorded fixtures, live check = HUMAN_NEEDED | med |

## Plan
Milestone M1 = read-only VK leads. Risks first.

- **S0 spike (wave 0)** — `lib/vk/client.ts` minimal + script `scripts/vk-spike.mjs`: call each method with a real
  token, record sanitised responses to `tests/fixtures/vk/*.json`, document limits/errors in this spec (Surprises).
  Verify: script prints method → ok/error code. Owns: `lib/vk/`, `scripts/vk-spike.mjs`, `tests/fixtures/vk/`.
- **T1 shared ingest refactor (wave 1)** — extract `ingestLeadCandidates` from `R` `scan_group` into
  `lib/processes/lead-ingest.ts`; generalise `leadMessageFingerprint` to accept a `msgKey`. REQ-13, REQ-6.
  Verify: `npm test` all green, no Telegram test changed. Owns: `R` (scan_group part), `lib/lead-filter.ts`, `lib/processes/`.
- **T2 VK client + limiter (wave 1, [P] with T1)** — `lib/vk/client.ts` (version, timeout, error mapping), `lib/vk/limiter.ts`
  (3 rps, daily cap, cooldown), `lib/vk/parse.ts` (post/comment/board → candidate + D4 key + deep link), `lib/vk/url.ts`.
  REQ-9, REQ-10, REQ-4 (parse). Verify: unit tests on fixtures. Owns: `lib/vk/*`, `tests/vk-*.test.ts`.
- **T3 VK scan + storage + cron (wave 2)** — record kinds, `R` VK actions, `scan_vk_source` via T1 ingest, notify mark,
  auto-rescan loop. REQ-1..8. Verify: route-level tests with `tests/helpers/workspace-harness.ts` + mocked `fetch`
  (search + group, rerun = 0 new leads, concurrent run = 1 lead, error 5/6/14 paths). Owns: `R` VK actions, cron route.
- **T4 UI (wave 3)** — via `/ui-task` (reuse existing components): Accounts VK section, Groups VK sources, Leads badge +
  filter + «Открыть в VK». REQ-11, REQ-12. Verify: ui-qa at 390/768/1440 + e2e on the local stand. Owns: `P`, `components/product/*`.
- **Gate (integrated)** — `npm run lint` (must not grow vs base), `npm test`, `npm run build`, Python unittest;
  `code-reviewer` + `security-reviewer` (token storage, new routes) + `verifier`; port to the local stand; live
  check with the owner's token.

Dependency: S0 → T2 fixtures; T1 ∥ T2 → T3 → T4.

## Verification plan
REQ-1..10, 13 → vitest (route + unit, fixtures from S0). REQ-11, 12 → ui-qa screenshots + e2e on stand.
Live VK (real token, ≥1 real lead from search and from a group) → stand, evidence = lead record + screenshot.

## Decision log
- 2026-10-01 TS client in the web app, separate kinds, platform-wide dedup key (D1–D4).

## Surprises
- (S0 fills this)

## Progress
- 2026-10-01 spec clarified; worktree `~/worktrees/wt-unilab-vk-lead-source`.
