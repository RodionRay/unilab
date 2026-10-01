# Lead core v2 — per-project lead finding with an LLM judge and approved conversations
status: clarified · owner: Rodion · created: 2026-10-01 · type: refactor+feature · size: full · model: claude-opus-5-5 (session, subagents inherit) · budget: 600M tokens
links: branch `task/lead-core-v2-2026-10-01` (forked from `origin/task/remove-risky-tg-2026-09-30`; merge `dev` when that lands) · PR -

## Goal
Every human message collected from a project's groups, channel comments and incoming DMs either reaches the
project's LLM judge or is dropped by a counted, visible cheap filter; judged leads get an AI draft that a human
approves before sending. Lead yield on the stand is no longer capped by hard-coded regexes (today 232 → 1).

## Non-goals
- Auto-sending (every send is a human click). Mass DMs, joins, mailings (removed by remove-risky-tg).
- New SQL tables: everything stays in `records` JSON (new kinds), no drizzle migration.
- Rewriting the Leads / Chats views beyond the project filter and the feedback buttons.
- Converting legacy `cold` leads (shown as warm).

## Context (stand DB, 83 scans since 2026-09-30)
Funnel fetched 12609 → old 3511 · minus 1813 · keyword prefilter 6789 · non-user 264 → 232 to core → 1 lead.
- `telegram-worker/src/check_account.py::scan_group` / `passes_lead_prefilter` / `find_minus_hit` / `AD_MARKERS` —
  keyword + intent + minus filtering in Python (duplicate of TS).
- `lib/lead-core.ts::scoreLead` — score capped at 44 without `BUYER_INTENT_RE`/`SOFT_ASK_RE` (Uniseller-specific),
  pass threshold `LEAD_SCORE_WARM`=45 → main killer.
- `route.ts::qualifyLeadsWithAi` + `applyAiVerdicts` — "if in doubt → []", unpicked = rejected; JSON by regex
  (`lib/ai-client.ts::aiChatText`).
- `reject_lead_stopwords`, `train_from_hot`, `train_from_ignored`, `lib/ai-keywords.ts` — auto-add message words
  to the minus list (poisoned it with product words «клиент», «остатков»).
- One `records kind='settings'` per owner = the only "project". view=ai = inline block `app/app/page.tsx` (~:3120),
  `components/product/lead-core-panel.tsx`.
- Existing — DO NOT recreate: `scan_group` account/join/lock handling (route.ts:1794–1949, keep as is),
  `scanCursor` + `history_window` paging, `leadMessageFingerprint` dedup + `leadTombstones`, `mutateLead` (CAS),
  `send_lead_message` (quotas, own account only), `pollDmReplies`/`/inbox-dms` + `mergeIncomingDm`,
  `flushLeadNotifications`, cron `app/api/cron/auto-rescan`.

## User stories
- US1 (P1) As an owner I describe each project in plain words (what we sell, who is a lead, who is not) and get leads
  from its groups without tuning keywords.
- US2 (P1) I see per project where messages went (how many collected, dropped by which filter, judged, leads) and
  sample dropped messages, so I can tell why there are no leads.
- US3 (P1) For a lead the AI drafts a reply (group reply, first DM, continuation of a DM thread); I edit and send.
- US4 (P2) I mark leads good / not a lead; the judge uses these as examples (no auto stop words).
- US5 (P2) A stranger who DMs our account with a matching need becomes a lead of the right project.

## Acceptance criteria (EARS)
Projects
- REQ-1 THE SYSTEM SHALL store projects as `records kind='project'` (contract below), ≤10 per owner, CRUD via
  `project_create` / `project_update` (field patch, zod) / `project_delete`; a delete with groups requires
  `moveToProjectId`.
- REQ-2 WHEN an owner has no project rows THE SYSTEM SHALL create one deterministic default project from the
  `settings` record (idempotent; product words removed from the carried stop list, ≤50 terms) and assign it to every
  group and lead without `projectId`.
- REQ-3 WHEN a group is added or imported THE SYSTEM SHALL assign the active project; `set_group_project` moves groups.
Collection + cheap filters
- REQ-4 THE worker `scan_group` SHALL return every message since the cursor whose sender is a non-bot user and text
  ≥3 chars, with counters `fetched`, `skippedNotUser`, `skippedOld`; it SHALL NOT filter by keywords, minus terms,
  ad markers or intent. Payload keys `keywords`/`minusKeywords` are ignored.
- REQ-5 THE pipeline (`lib/leads/filter.ts`) SHALL apply only, in order: older than `scanDepthDays` (`old`),
  text <12 chars after trim (`short`), already-known fingerprint / tombstone / same sender+text in this run
  (`duplicate`), word-start match of a project stop word (`stopword`); each drop increments its counter and keeps
  ≤3 samples (text ≤200 chars + matched term).
- REQ-6 THE SYSTEM SHALL NOT contain hard-coded product/intent regexes in the lead path (`BUYER_INTENT_RE`,
  `SOFT_ASK_RE`, `PRODUCT_FIT_RE`, `WEAK_PLUS_TERMS`, `AD_MARKERS`, Uniseller defaults); project keywords only
  order messages for judging (keyword hits first), never drop them.
Judge
- REQ-7 THE judge SHALL send messages that passed REQ-5 to the LLM in batches ≤20 with the project card, ≤10
  good + ≤10 bad examples, `response_format: json_object`, and SHALL validate the answer with zod:
  `{verdicts:[{id,isLead,score 0..100,temperature:'hot'|'warm',reason ≤200}]}`.
- REQ-8 WHEN a verdict has `isLead && score ≥ project.minScore` (default 50) THE SYSTEM SHALL create a lead;
  `temperature` hot only when score ≥80. Messages without a verdict in a valid answer count as `rejected`.
- REQ-9 IF the answer is invalid JSON/schema or the call fails THEN THE judge SHALL retry once, then count the
  batch as `judgeError` and THE scan SHALL NOT advance `scanCursor` past the first unjudged message.
- REQ-10 IF no AI key is configured or the owner's daily judge cap (default 3000 messages) is reached THEN THE scan
  SHALL count the messages as `judgeSkipped` with a reason, not advance the cursor past them, and the funnel SHALL
  show the reason. There is no non-LLM fallback.
- REQ-11 THE judge prompt SHALL treat message text as untrusted data (no instructions followed), forbid inventing
  facts, and require one verdict per input id.
Funnel
- REQ-12 WHEN a scan (group or DM pass) finishes THE SYSTEM SHALL write `records kind='scan_run'` (contract) and
  keep the newest 200 per project; GET returns scan runs of the last 7 days.
- REQ-13 THE funnel counters SHALL satisfy `fetched = skippedNotUser + skippedOld(worker) + collected` and
  `collected = old + short + duplicate + stopword + judgeSkipped + judgeError + rejected + leads` (test).
DMs
- REQ-14 WHEN an incoming DM matches an existing lead THE SYSTEM SHALL keep today's behaviour (`mergeIncomingDm`).
- REQ-15 WHEN an incoming DM does not match a lead and the sender is not a bot nor one of the owner's accounts
  THE SYSTEM SHALL run REQ-5 + the judge against each active project (stop at the best score ≥ minScore) and create
  a lead with `sourceKind:'dm'`, `conversationOpen:true` in that project; dropped DMs count in a `scan_run` with
  `source:'dm:<accountId>'`.
Drafts + approval
- REQ-16 `draft` SHALL take `{id, kind:'group_reply'|'dm_first'|'dm_continue'}`, build the prompt from the lead's
  project card + the thread (last 12 entries of `replies`), and store `lead.pendingDraft` (contract); 1/min per
  owner guard stays.
- REQ-17 WHEN a judged lead is created and `project.autoDraft` (default true) THE SYSTEM SHALL generate a
  `pendingDraft` (kind `group_reply` for group/discussion/comment, `dm_first`… for dm → `dm_continue`) within the
  owner's AI cap, without sending.
- REQ-18 `send_lead_message` SHALL accept `draftId`; on success the draft becomes `sent`; `dismiss_draft` sets
  `dismissed`. Nothing is sent without this explicit action.
Feedback
- REQ-19 `lead_feedback {id, verdict:'good'|'bad'}` SHALL add the lead text (≤300 chars) to the project's
  `goodExamples`/`badExamples` (FIFO ≤20 each) and SHALL NOT change stop words. `suggest_stopwords` may return
  suggestions; only `project_update` changes the list.
- REQ-20 THE SYSTEM SHALL remove `preview_lead_core`, `train_from_hot`, `train_from_ignored`,
  `reject_lead_stopwords`, `lib/lead-core.ts`, `lib/ai-keywords.ts` auto-minus, `lead-core-panel.tsx` and the
  Python matcher/fixtures; unknown actions return the existing 400.
UI (view=ai, `components/product/ai/**`)
- REQ-21 THE AI page SHALL show: project switcher (+ create), project card editor (sections: что продаём · кто лид ·
  кто не лид · тон и призыв · стоп-слова · примеры · порог), funnel for 24 h / 7 d (one row per step with count,
  expandable samples, judge/AI-key errors in plain Russian), and an approval queue of pending drafts (edit, send,
  dismiss, open thread).
- REQ-22 (UI states) loading, empty (no project / no groups / no scans yet with the next action), error and success
  states SHALL render at 390 / 768 / 1440 without horizontal scroll; project save is a field patch (no full-object
  overwrite).
- REQ-23 THE Leads view SHALL filter by project and replace the old reject/train buttons with «Хороший лид» /
  «Не лид» (`lead_feedback`).
Ops
- REQ-24 THE cron `auto-rescan` SHALL scan through the same pipeline (`lib/leads/pipeline.ts::runGroupScan`) — one
  code path for manual and auto scans.

## Contracts
- `project` data: `{name, url, product, audience, leadCriteria, notLead, valueProps, tone, cta, keywords:string[] ≤30,
  stopWords:string[] ≤50, goodExamples:string[] ≤20, badExamples:string[] ≤20, minScore:0..100=50,
  scanDepthDays:1..30=7, autoDraft:boolean=true, active:boolean=true, updatedAt}`; id = uuid, default project id =
  `uuidv5(owner, 'unilab-default-project')`.
- `group.projectId`, `lead.projectId`, `lead.score`, `lead.reason`, `lead.sourceKind:'group'|'discussion'|'comment'|'dm'`,
  `lead.pendingDraft:{id,kind,text,status:'pending'|'sent'|'dismissed',createdAt}`.
- `scan_run` data: `{projectId, source:'group:<id>'|'dm:<accountId>', at, ms, counts:{fetched, skippedNotUser,
  skippedOldWorker, collected, old, short, duplicate, stopword, judged, judgeSkipped, judgeError, rejected, leads},
  samples:{[step]:[{text,term?,reason?}]}, error?}`.
- Worker `/scan-group` response: unchanged fields minus `skippedMinus`/`skippedKw`, plus `skippedOld`; messages
  carry today's fields.
- `lib/leads/` modules: `types.ts`, `filter.ts` (pure), `prompt.ts`, `judge.ts` (`judgeMessages(project, msgs, llm)`),
  `pipeline.ts` (`runGroupScan(deps)`, `runDmJudge(deps)` with injected db/worker/llm/clock), `funnel.ts`
  (`recordScanRun`, `aggregateFunnel`), `projects.ts` (`ensureDefaultProject`, CRUD helpers), `draft.ts`.
  `lib/ai-client.ts` gains `aiChatJson(schema)`.

## NFRs
- ≤10 judge calls per group scan (≤200 messages); DeepSeek timeout 90 s; group scan ≤120 s p95.
- Daily per-owner caps: judge 3000 messages, drafts 200 (owner settings, editable).
- Multi-tenant: every query `owner=?`; project ids validated against owner on every action.
- Lead message text never logged; samples stored truncated to 200 chars.

## Assumptions ledger
- A-1 DeepSeek `deepseek-chat` supports `response_format:{type:'json_object'}` | api docs | else prompt-only JSON + zod + retry | high
- A-2 remove-risky-tg lands on dev before this PR | its spec status in-progress | else rebase onto dev, conflicts in route.ts/page.tsx | med
- A-3 Worker already drops bots/channel authors cheaply before `get_sender` cost | check_account.py:1183 | else count only | high
- A-4 Per-DM judge against ≤10 projects is affordable (new DM senders are rare) | stand: 14 leads with replies | else one call with all projects | med
- A-5 records-JSON scan_run (200/project) fits D1 row/GET budget | ~1 KB each | else move to a table | med

## Clarifications
### Session 2026-10-01
- Q: target repo → A: unilab dev. · Q: multi-project → A: yes, migrate settings into the first project.
- Q: conversation mode → A: AI drafts, human approves every send. · Q: DMs as source → A: yes, judge incoming DMs.

## Plan (HOW)
- M1 walking skeleton: one group scan through worker raw → filter → judge → lead → scan_run, visible in the funnel.
- Wave 1 [P]
  - [ ] T1 `core` [backend] owns `lib/leads/**`, `lib/ai-client.ts`, `tests/leads/**` — REQ-5..11,13,16(prompt),19(pure)
    — verify `npx vitest run tests/leads` → green, REQ-13 invariant test.
  - [ ] T2 `worker` [backend] owns `telegram-worker/src/check_account.py` (scan + inbox flags), `telegram-worker/tests/**`
    — REQ-4,15(worker flags `isBot`, own-account ids passthrough) — verify `cd telegram-worker && python -m pytest -q`.
- Wave 2 (depends T1+T2 contracts)
  - [ ] T3 `api` [backend] owns `app/api/workspace/route.ts`, `app/api/cron/**`, `lib/processes/**`,
    `lib/workspace-schemas.ts`, `lib/lead-*.ts` removal, `tests/*route*|cron*|lead*` — REQ-1..3,12,14,15,17,18,20,24.
  - [ ] T4 `ui` [frontend, ui-builder via /ui-task] owns `components/product/ai/**`, `app/app/page.tsx`,
    `components/product/lead-core-panel.tsx` removal, `tests/ui-*`, e2e spec — REQ-21..23 against the contract above.
- Wave 3: integrate, full gate, code-reviewer + security-reviewer + verifier, e2e on the local stand, replay eval.

## Verification plan
| REQ | evidence | command / artefact |
|---|---|---|
| 4 | pytest: no keyword/minus drop, counters | `telegram-worker/tests/test_scan_raw.py` |
| 5,6,13 | vitest filter + invariant + grep no regex | `tests/leads/filter.test.ts`, `rg BUYER_INTENT_RE lib app` → 0 |
| 7–11 | vitest judge with fake LLM (valid, invalid→retry, error, missing ids, injection text) | `tests/leads/judge.test.ts` |
| 1–3,12,14–20,24 | vitest route with D1 fake | `tests/leads-route.test.ts`, `tests/cron-auto-rescan.test.ts` |
| 21–23 | ui-qa 390/768/1440 + design panel + e2e | `artifacts/ui-qa/lead-core-v2/`, e2e spec |
| Goal | replay: stand fixture of 60 labelled messages (30 lead / 30 not) through the real judge, recall ≥80 %, precision ≥70 % | `scripts/eval-lead-judge.mjs` → `artifacts/lead-eval/` (HUMAN_NEEDED without key) |

## Definition of done
All REQ rows have evidence · local gate green (lint, tsc, vitest, pytest, build) · docs `docs/leads-pipeline.md`
with symbol anchors · STATE/DECISIONS lines · verifier verdict in PR.

## Decision log
- 2026-10-01 LLM judge is the only lead gate; cheap filters only drop provably useless messages, all counted (owner
  decision: logic must be understandable; regex cap killed 231/232).
- 2026-10-01 Learning = examples in the prompt, never auto stop words (self-poisoning observed on the stand).
