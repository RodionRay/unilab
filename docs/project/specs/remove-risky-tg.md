---
status: in-progress
model: claude-opus-5-5 (session)
budget: 600M tokens
size: full
branch: task/remove-risky-tg-2026-09-30 → dev
---
# Remove account-risky Telegram features

Goal: UniLab stops doing bulk actions that get Telegram accounts banned. Lead scanning, lead DMs,
account/proxy management and a manual single-group join stay.

## Owner decisions (2026-09-30)
- Mass joining removed; manual "Вступить" per group stays (pace + daily join quota gate).
- Audience collection, member inviting, mailings removed entirely (API, worker, UI, tests, copy).
- Account mix removed: no round-robin group assignment, no farm rotation for joins/scans/DMs.
  Assigned account unavailable → explicit error, no silent substitution.
- Discussion chats: manual gated "Вступить в обсуждение" (owner 2026-09-30); scan never joins.
- DB rows of kinds audience_task / audience_user / invite_task / mailing_task stay in D1; code ignores them.
  No migration.
- Staff invites (create_invite / accept_invite / app/invite/[token]) are unrelated and stay.

## Requirements (EARS)
- REQ-1 The workspace API shall not accept actions start/pause/tick/export for audience, invite or mailing
  (unknown action → existing 400 path), nor `enqueue_joins`, `heal_dead_group_accounts`, `refill_mailing_ai_pool`.
- REQ-2 The workspace API shall reject saving records of kinds audience_task, audience_user, invite_task,
  mailing_task; GET shall not return them.
- REQ-3 `assign_group_accounts` shall accept only one account for the selected groups (no `mode:'mix'`).
- REQ-4 When the group's assigned account is unusable, `join_group`, `scan_group`, `rescan_groups` and the
  auto-rescan cron shall return/log an error for that group and shall not switch to another account.
- REQ-5 `send_lead_message` shall send only from the lead's account; when it is unusable it shall return an
  error without switching accounts.
- REQ-6 The auto-rescan cron shall not join groups; groups needing a join are skipped and logged.
- REQ-7 `import_catalog` shall add groups without joining them.
- REQ-8 The worker shall not expose /collect-audience or /invite-users; python `collect_audience` and
  `invite_users` are removed.
- REQ-9 The app UI shall have no Сбор аудитории / Инвайтинг / Рассылка sections, no "Вступить во все",
  no background join queue, no mix option; per-group "Вступить" still works.
- REQ-10 Marketing pages, README, SERVER_HANDOFF, assistant knowledge and notification copy shall not
  advertise the removed features.
- REQ-12 The worker's scan shall never join a channel's linked discussion chat; it reports needDiscussionJoin.
  `join_group` with `target:'discussion'` shall join only that linked chat through the same pace + daily quota
  gate (one join), using only the assigned account; the UI shows "Вступить в обсуждение" for such groups.
  Only a broadcast channel's linked chat is joined: a non-broadcast source (megagroup) returns
  `join:'no_discussion'` with no JoinChannel call, and the API releases the slot without spending quota/pace.
- REQ-13 Concurrent manual joins for one account shall be serialized (reserveJoinSlot); after a real Telegram
  call (success, already, banned/private/failed, timeout) the pace slot is kept; stale joinState
  queued/waiting from the removed queue is cleared.
- REQ-11 Lint does not grow vs base, `npx tsc --noEmit` errors do not grow vs base, vitest and python tests
  green, `npm run build` green.

## Split
- wave 1 (parallel):
  - `api` [backend] owns app/api/**, lib/**, tests/** (TS), scripts/**. REQ-1..7, lib/security authz, copy in lib/.
  - `worker` [backend] owns worker-app.mjs, telegram-worker/**. REQ-8.
  - `ui` [frontend] owns app/app/**, app/page.tsx, components/**. REQ-9, REQ-10 (UI part).
- orchestrator: README.md, SERVER_HANDOFF.md, SOURCE_MANIFEST.json, docs/project/**. REQ-10 (docs).

Contract between `api` and `ui`: lib/mailing.ts and lib/audience-invite.ts are trimmed, not deleted; symbols
used by the UI outside the removed panels (DM settings like DEFAULT_DM_SOFT_CLOSE, pushTaskLog(s),
formatRuWhen, normalizeTgRef, parseGroupUrlLines, telegramMessageLink, relativeRu, displayTgHandle) keep
their names and paths. `ui` must not import removed symbols.

## Verification
vitest, python unittest, lint, tsc, build; code-reviewer + security-reviewer (routes/authz touched) + verifier.
e2e: NOT_VERIFIED (no stand, no e2e runner in repo).
