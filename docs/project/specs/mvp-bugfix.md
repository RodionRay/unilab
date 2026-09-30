---
status: done (verifier PASSED 2026-09-30; REQ-V2 save-time check covers known channels only — unknown channels fail on first tick)
size: full
model: claude-opus-5-5 (effort: session)
budget: 600M tokens
base: dev @5b14974 (+ merged task/lead-stopwords-fix-2026-09-30)
integration: task/mvp-bugfix-2026-09-30
---
# MVP bugfix — invite, mailing, audience, leads, chats

Source: 5 read-only audits 2026-09-30 (code at 5b14974). `R` = app/api/workspace/route.ts,
`PY` = telegram-worker/src/check_account.py. Line numbers are from 5b14974 — re-locate by symbol.
Gate baseline: vitest 405/405 green; tsc 51 errors; lint 289 problems (red base, pre-existing) → must not grow.

## Wave 1

### infra — shared tick runtime (invite / mailing / audience)
- REQ-I1 Tick lock is taken atomically (one conditional UPDATE that succeeds only when lock empty/expired; row-changed
  check); TTL covers the worst-case tick or is renewed before every worker call. Two concurrent ticks of one task →
  exactly one runs. `start`/`pause`/`save` never clear a live lock.
- REQ-I2 Worker 429 (`WorkerBusyError`) or our own abort timeout inside a tick → task stays `running`, `nextAt` =
  now+30–60 s, lock released; never `status:'error'`. Progress done before the failure (delivered keys, invited
  users, counters, deliveries, account quota bumps) is persisted in the catch.
- REQ-I3 Pausing while a tick is in flight keeps status `paused` but merges the tick's progress fields (invite:
  done/invitedToday/log; mailing: deliveredKeys/sentTotal/deferredUntil/deliveries).
- REQ-I4 Server-side runner: `POST /api/cron/tasks-tick` (Bearer CRON_SECRET, same guard as auto-rescan) ticks due
  `running` and `scheduled` (nextAt ≤ now) invite / mailing / audience tasks for every owner, bounded time budget
  with `more:true`; telegram-worker `server.mjs` calls it in a loop like auto-rescan. Closing the browser tab does
  not stop tasks; scheduled tasks resume at `nextAt`.
- REQ-I5 Editing (save) a task keeps server-side progress/status/lock (done, invitedToday, accountIndex,
  deliveredKeys, counters, tickLockUntil); only config fields come from the client. Audience: changing url or
  collectMode resets cursor/collected/hasMore.
- REQ-I6 App-side worker timeouts ≥ worker job timeout (worker-app.mjs) + queue margin (collect-audience 90 s vs
  180 s; send/invite/join) — a slow-but-successful worker call is not reported as a failure.

### leads
- REQ-L1 AI filter per batch: a batch that succeeded is trusted (incl. `[]` = reject all); only failed batches
  (throw/429/timeout) fall back to core-passing candidates.
- REQ-L2 `scan_group` of one group cannot run concurrently (cron + manual force): lock per group; the same
  message never produces two leads or two notifications.
- REQ-L3 Lead tabs: viewed/unviewed split applies only to «Все»/«Новые»; «В работе», «Архив», «Горячие»,
  «Тёплые» show viewed leads.
- REQ-L4 Worker prefilter (`passes_kw`) does not drop buyer-intent messages the core would accept (port
  BUYER_INTENT_RE / SOFT_ASK_RE patterns or equivalent).
- REQ-L5 Plus-words, signals and criteria match Russian word forms (stem/prefix match) with ё→е on both sides, in
  core and worker (parity).
- REQ-L6 A deleted lead is not re-created by the next scan (tombstone included in dedupe).
- REQ-L7 Per-group cursor: worker reads from last seen message id to the depth cutoff (paged), not only newest 200.
- REQ-L8 Dedupe key is `groupId:tgMsgId` when tgMsgId exists (edited message ≠ new lead).
- REQ-L9 Failed notification is logged and retried on the next tick (per-lead `notifiedAt`).
- REQ-L10 Lead `save` merges server-owned fields (replies, needsManager, coreScore, …) instead of overwriting.
- REQ-L11 AI-rejected messages are remembered (with TTL) and not re-sent to AI every rescan.
- REQ-L12 Route uses the tested helpers (or tests target the real route path) — no tests of dead copies.

### chats
- REQ-C1 Reply in `mode:'chat'` never overwrites lead sender fields (only `mode:'dm'` does).
- REQ-C2 `poll_dm_replies` re-reads the lead right before merging (no lost update of manager replies/status).
- REQ-C3 Inbox polling does not lose incoming DMs: no fixed 30 dialogs × 8 messages window with a cursor jumping past
  unscanned dialogs (use unread/min_id per dialog; cursor advances only over what was scanned).
- REQ-C4 Reply send is idempotent: pending entry before send, app timeout > worker queue+job time; a timeout does not
  lead to a duplicate on retry.
- REQ-C5 `accountId` of the conversation changes only on a successful send.
- REQ-C6 Kept conversation account still honours cooldown/quota (429 with message instead of bypass).
- REQ-C7 One `poll_dm_replies` per owner at a time (lease); duplicate notifications impossible.
- REQ-C8 Failed send does not clear `needsManager`/set viewed.
- REQ-C9 Incoming DM does not reopen won/lost leads.
- REQ-C10 DM dedupe by `accountId:messageId`.
- REQ-C11 `viewed` mark: viewer 403 is not shown as success; chats-viewed test covers the real code.
- REQ-C12 (security) Assistant AI key is paired with its base URL — an OpenAI key is never sent to DeepSeek; non-OK
  responses are logged.

## Wave 2 (on top of infra)

### invite
- REQ-V1 `InviteToChannelRequest` result: `missing_invitees` → per-user `error:'privacy'`, not ok.
- REQ-V2 Target-level errors (need_admin, chat full, broadcast channel, unresolvable target, `ok:false` without
  results) → task error/pause with a clear message; users are NOT marked invited. Save-time validation of target type.
- REQ-V3 Task daily limit → `scheduled` with nextAt = next Moscow midnight; batch capped to remaining limit.
- REQ-V4 Already-member counted separately, no quota bump; privacy = permanent skip (`skipReason`), no retries.
- REQ-V5 Account quota bumped for invites done before a FloodWait return.
- REQ-V6 Audience rows for the task loaded with SQL filter + LIMIT (no full-owner scan per tick).
- REQ-V7 Route uses `lib/processes/invite-tick.ts` helpers (tests cover the real path).

### mailing
- REQ-M1 `PeerFloodError` → status `spamblock` (account marked, not treated as FloodWait).
- REQ-M2 Delivery state per recipient is not capped at 5000 (no re-send in big audiences).
- REQ-M3 Cross-task dedupe: a person already DMed by another mailing is not DMed again (leads from «Рассылка» /
  `u:<id>` across tasks).
- REQ-M4 FloodWait sets account `floodUntil` and the picker skips flooded accounts.
- REQ-M5 «нет access_hash» retried at most N times per recipient, then permanent failure; task can complete.
- REQ-M6 okN credited per account; account quota checked before each send; task dailyLimit caps the batch.
- REQ-M7 Quota cooldown applies only for the kind just used (DM vs joins).
- REQ-M8 spamblock honours `cooldownUntil` expiry (not forever) — or documented if intentional.
- REQ-M9 Route uses `lib/processes/mailing-tick.ts` helpers; `Cand` type fixed (no excess-property TS error).

### audience
- REQ-A1 collect_audience RPC errors classified: FloodWait → flood+waitSec, ChannelPrivate/invite errors → task
  error; account marked unauthorized only on real dead-session errors.
- REQ-A2 Our own abort timeout is not treated as a proxy fault (no markProxyTelegramBad) — retryable tick.
- REQ-A3 Join result `requested` → task paused «ждём одобрения заявки», no join loop.
- REQ-A4 Audience-task join goes through the join gate (quota/pace) and bumps join counters; flood paces account.
- REQ-A5 Participants paging by offset (no restart from 0 every tick); truncation (Telegram ~10k cap) shown as a
  warning.
- REQ-A6 Audience rows: SQL filter by task, batched inserts, ordered latest seen ids; no duplicate audience_user
  rows for (task, user).
- REQ-A7 Source peer (channelId/accessHash/accountId) from join is saved and reused.
- REQ-A8 messageLimit enforced across batches in message mode.
- REQ-A9 `t.me/c/…` and `t.me/s/…` links parsed in the worker.

## Out of scope
Minor UI polish, lint/tsc base cleanup (separate fix/lint-green PR), history pagination in chats, media rendering.

## Verification
Per REQ: a vitest test RED before the fix (route-level via existing D1 sqlite helpers where possible; python unit tests
in telegram-worker/tests for PY changes). Integrated: vitest, tsc/lint no growth, `npm run build`, python tests.
Live Telegram: NOT_VERIFIED (no stand with real accounts in this session).
