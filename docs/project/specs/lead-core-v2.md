# Lead core v2 — per-project lead finding with an LLM judge and approved conversations
status: clarified · plan-reviewed 2026-10-01 · owner: Rodion · created: 2026-10-01 · type: refactor+feature · size: full · model: claude-opus-5-5 (session, subagents inherit) · budget: 600M tokens
links: branch `task/lead-core-v2-2026-10-01` (forked from `origin/task/remove-risky-tg-2026-09-30`; merge `dev` when that lands) · PR -

## Goal
Every human message collected from a project's groups, channel comments and incoming DMs either reaches the
project's LLM judge or is dropped by a counted, visible cheap filter; judged leads get an AI draft that a human
approves before sending. Lead yield on the stand is no longer capped by hard-coded regexes (today 232 → 1).

## Non-goals
- Auto-sending (every send is a human click). Mass DMs, joins, mailings (removed by remove-risky-tg).
- New SQL tables or drizzle migrations: everything stays in `records` JSON (new kinds). No bulk data migration.
- Rewriting the Leads / Chats views beyond the project filter, feedback buttons and the «Переписки» filter fix.
- Converting legacy `cold` leads (shown as warm). Stop-word suggestions (`suggest_stopwords` cut).

## Context (stand DB, 83 scans since 2026-09-30)
Funnel fetched 12609 → old 3511 · minus 1813 · keyword prefilter 6789 · non-user 264 → 232 to core → 1 lead.
- `telegram-worker/src/check_account.py::scan_group` / `passes_lead_prefilter` / `find_minus_hit` / `AD_MARKERS` —
  keyword + intent + minus filtering in Python (duplicate of TS); `get_sender` exceptions silently dropped (:1183).
- `lib/lead-core.ts::scoreLead` — score capped at 44 without `BUYER_INTENT_RE`/`SOFT_ASK_RE`, pass threshold 45.
- `route.ts::qualifyLeadsWithAi` + `applyAiVerdicts` — "if in doubt → []", unpicked = rejected; JSON by regex.
- `reject_lead_stopwords`, `train_from_hot`, `train_from_ignored`, `lib/ai-keywords.ts` — auto-minus poisoning.
- One `records kind='settings'` per owner = the only "project". view=ai = inline block `app/app/page.tsx` (~:3120).
- Existing — DO NOT recreate: `scan_group` account/join/lock handling (route.ts:1794–1949), `scanCursor` +
  `check_account.py::history_window` (`offset_id`, `reverse=True`, exclusive), `leadMessageFingerprint` +
  `leadTombstones`, AI-reject memory `lib/processes/scan-flow.ts::activeAiRejects`/`rememberAiRejects`
  (`group.aiRejected`, TTL, project signature), `mutateLead` (CAS), `send_lead_message` (takes text, own account),
  `poll_dm_replies` (90 s budget, `settings.inboxPollCursor`) + `mergeIncomingDm`, `flushLeadNotifications`,
  ai_guard rows (route.ts:1436), cron `app/api/cron/auto-rescan/route.ts` (calls `scan_group` over HTTP, :222).

## User stories
- US1 (P1) As an owner I describe each project in plain words and get leads from its groups without tuning keywords.
- US2 (P1) I see per project where messages went (collected, dropped by which filter, judged, leads) with samples.
- US3 (P1) For a lead the AI drafts a reply (group reply, first DM, DM continuation); I edit and send.
- US4 (P2) I mark leads good / not a lead; the judge uses these as examples (no auto stop words).
- US5 (P2) A stranger who DMs our account with a matching need becomes a lead of the right project.

## Acceptance criteria (EARS)
Projects
- REQ-1 THE SYSTEM SHALL store projects as `records kind='project'` (contract), ≤10 per owner, CRUD via
  `project_create` / `project_update` (field patch, zod) / `project_delete`; a delete with groups requires `moveToProjectId`.
- REQ-2 WHEN an owner has no project row THE SYSTEM SHALL lazily create the default project from `settings`
  (`INSERT OR IGNORE`, id `uuidv5(owner,'unilab-default-project')`, carried stop list ≤50 without product words);
  a group/lead without `projectId` SHALL read as the default project id (no bulk rewrite).
- REQ-3 WHEN a group is added or imported THE SYSTEM SHALL assign the active project; `set_group_project` moves groups.
- REQ-4 AFTER migration project fields SHALL live only in `project`: `rebuild_product` fills the active project card
  (AI from project `url`), `generate_account_about` reads the active/default project; `settings` keeps keys,
  notifications, rescan, `inboxPollCursor`, daily caps.
Collection + cheap filters
- REQ-5 THE worker `scan_group` SHALL return ≤80 messages since the cursor from non-bot users with text ≥3 chars,
  counters `fetched`, `skippedNotUser`, `skippedOld`, `skippedError` (`get_sender` exception), and SHALL NOT filter by
  keywords, minus terms, ad markers or intent; payload `keywords`/`minusKeywords` ignored. First scan (no cursor) depth = 1 day.
- REQ-6 THE pipeline (`lib/leads/filter.ts`) SHALL apply only, in order: empty `tgMsgId` (`skippedError`), older than
  `scanDepthDays` (`old`), text <12 chars (`short`), known fingerprint / tombstone / active AI-reject memory /
  same sender+text in this run (`duplicate`), word-start stop-word match (`stopword`); each drop counts + keeps ≤3 samples.
- REQ-7 THE lead path SHALL NOT contain hard-coded product/intent regexes (`BUYER_INTENT_RE`, `SOFT_ASK_RE`,
  `PRODUCT_FIT_RE`, `WEAK_PLUS_TERMS`, `AD_MARKERS`, Uniseller defaults); project keywords are a prompt hint only.
Judge
- REQ-8 THE judge SHALL send passed messages in ascending `tgMsgId` batches ≤20 (≤4 per scan) with the project card
  and ≤10 good + ≤10 bad examples, `response_format: json_object`, timeout 35 s, one retry, and validate with zod
  `{verdicts:[{id,isLead,score 0..100,reason ≤200}]}`.
- REQ-9 WHEN `isLead && score ≥ project.minScore` (default 50) THE SYSTEM SHALL create a lead, hot when score ≥80;
  ids without a verdict in a valid answer count `rejected`, and rejected ids enter the AI-reject memory.
- REQ-10 IF a batch fails (invalid JSON/schema or call error after retry → `judgeError`) or is skipped (no AI key or
  daily judge cap → `judgeSkipped` + reason) THEN THE scan SHALL stop judging, count later batches `judgeSkipped`
  (`blocked`) and set `scanCursor = firstUnjudgedId − 1` — only for `messageKind` group/discussion; comment ids never
  reach the cursor. There is no non-LLM fallback. Exceptions (code review 2026-10-01, poison-batch guard): an answer
  still invalid JSON/schema after the retry moves the cursor past that batch (`judgeError`, counted, samples kept);
  after 3 consecutive rewinding scans of a group (`judgeFailStreak`) the cursor jumps to the worker cursor and a
  Russian warn line goes to scanLog/rescanLog.
- REQ-11 THE judge prompt SHALL treat message text as untrusted data, forbid inventing facts, require one verdict per id.
Funnel
- REQ-12 WHEN a scan (group or DM pass) finishes THE SYSTEM SHALL atomically upsert `scan_day`
  (id `scan-day:<projectId>:<YYYY-MM-DD>`: summed counters, last 3 samples per step, last 20 run summary lines);
  `scan_day` is not in `RECORD_KINDS`/GET and is served by action `funnel {projectId, days:1|7}`.
- REQ-13 Counters are events per run (not unique messages) and SHALL satisfy `fetched = skippedNotUser +
  skippedOldWorker + skippedErrorWorker + returned` and `returned = skippedErrorApp + old + short + duplicate +
  stopword + judgeSkipped + judgeError + rejected + leads` (test).
DMs
- REQ-14 WHEN an incoming DM matches an existing lead THE SYSTEM SHALL keep `mergeIncomingDm`.
- REQ-15 WHEN unmatched DMs arrive from non-bot senders that are not the owner's accounts (app-side check of
  username/userId against account records) THE SYSTEM SHALL group them by userId, apply REQ-6, and judge ≤20 senders
  in ≤1 LLM call per poll pass with all active project cards → `{id, projectId|null, score, reason}`; a match ≥ that
  project's minScore creates a lead `sourceKind:'dm'`, `conversationOpen:true`.
- REQ-16 IF the DM judge fails or is skipped THEN THE pass SHALL count `judgeError`/`judgeSkipped` (also senders
  over 20) and still advance `inboxPollCursor`, within the `poll_dm_replies` 90 s budget.
Drafts + approval
- REQ-17 `draft {id, kind:'group_reply'|'dm_first'|'dm_continue'}` SHALL build the prompt from the lead's project
  card + last 12 `replies` and store `lead.draft` + `lead.draftKind`; the 1/min manual guard stays.
- REQ-18 WHEN a hot lead is created and `project.autoDraft` (default true) THE SYSTEM SHALL draft it after the
  response (`next/server` `after()`), ≤3 per scan, own guard key, within the daily draft cap, never sending.
- REQ-19 `send_lead_message` (text) SHALL clear `draft`/`draftKind` on success; `dismiss_draft {id}` clears them.
  Nothing is sent without this explicit action.
- REQ-20 «Переписки» SHALL list only leads with `conversationOpen` or a manual draft (no `draftKind`-only auto
  drafts); auto drafts are approved in the AI page queue.
Feedback + removal
- REQ-21 `lead_feedback {id, verdict:'good'|'bad'}` SHALL add the lead text (≤300 chars) to `goodExamples`/
  `badExamples` (FIFO ≤10 each) and SHALL NOT change stop words; only `project_update` edits stop words.
- REQ-22 THE SYSTEM SHALL remove `preview_lead_core`, `train_from_hot`, `train_from_ignored`,
  `reject_lead_stopwords`, `suggest_stopwords` and the files listed in the plan; unknown actions return the existing 400.
Security
- REQ-23 `lib/security/workspace-authz.ts` SHALL have `ACTION_RULES` for `project_create`, `project_update`,
  `project_delete`, `set_group_project`, `lead_feedback`, `dismiss_draft`, `funnel` (old actions removed);
  `project` readable by sections ai + leads; read kinds split from writable kinds so generic `save`/`delete`
  (`route.ts::kindSchema`, :41) cannot write `project`.
- REQ-24 `lib/processes/scan-flow.ts::SERVER_OWNED` SHALL add lead `projectId`, `score`, `reason`, `sourceKind`,
  `draftKind` and group `projectId`; every action validates project ids against `owner`.
UI (view=ai, `components/product/ai/**`)
- REQ-25 THE AI page SHALL show: project switcher (+ create), card editor (что продаём · кто лид · кто не лид ·
  тон и призыв · стоп-слова · примеры · порог), funnel 24 h / 7 d (row per step, expandable samples, judge/AI-key
  errors in plain Russian), approval queue of drafts (edit, send, dismiss, open thread).
- REQ-26 Loading, empty (no project / no groups / no scans + next action), error and success states SHALL render at
  390 / 768 / 1440 without horizontal scroll; project save is a field patch.
- REQ-27 THE Leads view SHALL filter by project and replace reject/train buttons with «Хороший лид» / «Не лид».

## Contracts
- `project` data: `{name, url, product, audience, leadCriteria, notLead, valueProps, tone, cta, keywords:string[] ≤30,
  stopWords:string[] ≤50, goodExamples:string[] ≤10, badExamples:string[] ≤10, minScore:0..100=50,
  scanDepthDays:1..30=7, autoDraft:boolean=true, active:boolean=true, updatedAt}`; id = uuid; default id =
  uuidv5 via `node:crypto` sha1 in `lib/leads/projects.ts`.
- `group.projectId`, `lead.projectId`, `lead.score`, `lead.reason`, `lead.sourceKind:'group'|'discussion'|'comment'|'dm'`,
  `lead.draft` (existing) + `lead.draftKind:'group_reply'|'dm_first'|'dm_continue'|undefined` (set only by auto draft).
- `scan_day` data: `{projectId, day, counts:{fetched, skippedNotUser, skippedOldWorker, skippedError, returned, old,
  short, duplicate, stopword, judged, judgeSkipped, judgeError, rejected, leads}, samples:{[step]:[{text≤200,term?,
  reason?}] ≤3}, runs:[string ≤200] ≤20}`; one atomic `INSERT … ON CONFLICT(id) DO UPDATE` per run.
- Daily caps: ai_guard rows `judge-day:<owner>:<YYYY-MM-DD>` / `draft-day:<owner>:<YYYY-MM-DD>`, atomic `json_set`
  increment; auto-draft guard key separate from `ai-guard:<owner>`.
- Worker `/scan-group` response: today's fields minus `skippedMinus`/`skippedKw`, plus `skippedOld`, `skippedError`.
- `lib/leads/` modules: `types.ts`, `filter.ts` (pure, incl. stop-word matcher), `prompt.ts`, `judge.ts`
  (`judgeMessages(project, msgs, llm)` → verdicts + `firstUnjudgedId`), `dm-judge.ts` (`judgeDmSenders(projects,
  senders, llm)`), `pipeline.ts` (`runGroupScan(deps)`, `runDmJudge(deps)`; injected db/worker/llm/clock),
  `funnel.ts` (`upsertScanDay`, `readFunnel`), `projects.ts` (`ensureDefaultProject`, `projectIdOf`, CRUD), `draft.ts`.
  `lib/ai-client.ts` gains `aiChatJson(schema, {timeoutMs:35000, retries:1})`.

## NFRs
- Group scan ≤4 judge calls (≤80 messages); judge call timeout 35 s + one retry; group scan ≤120 s p95.
- DM pass ≤1 judge call (≤20 senders) inside the 90 s `poll_dm_replies` budget.
- Daily per-owner caps: judge 3000 messages, drafts 200 (owner settings, editable).
- Multi-tenant: every query `owner=?`; project ids validated against owner on every action.
- Lead message text never logged; samples stored truncated to 200 chars.

## Assumptions ledger
- A-1 DeepSeek `deepseek-chat` supports `response_format:{type:'json_object'}` | api docs | else prompt-only JSON + zod + retry | high
- A-2 remove-risky-tg lands on dev before this PR | its spec status in-progress | else rebase onto dev, conflicts in route.ts/page.tsx | med
- A-3 Worker drops bots/channel authors before costly work | check_account.py:1186 | else count only | high
- A-5 One `scan_day` row per project per day (counters + 3 samples/step + 20 runs) stays ≤ ~8 KB | estimate | else trim runs to 10 | med

## Clarifications
### Session 2026-10-01
- Q: target repo → A: unilab dev. · Q: multi-project → A: yes, migrate settings into the first project.
- Q: conversation mode → A: AI drafts, human approves every send. · Q: DMs as source → A: yes, judge incoming DMs.

## Plan (HOW)
- M1 walking skeleton: one group scan through worker raw → filter → judge → lead → scan_day, visible in `funnel`.
- Wave 1 [P]
  - [ ] T1 `core` [backend] owns `lib/leads/**`, `lib/ai-client.ts`, `lib/lead-filter.ts` (keep
    `leadMessageFingerprint`/`normalizeLeadMessage`/`parseLeadTemperature`, strip regex exports), `tests/leads/**`
    — REQ-6..11,13,15(judge),17(prompt),21(pure) — verify `npx vitest run tests/leads` → green incl. REQ-13 invariant.
  - [ ] T2 `worker` [backend] owns `telegram-worker/src/check_account.py`, `telegram-worker/tests/**`,
    `tests/fixtures/minus-match.json`, `tests/fixtures/lead-match.json` (delete) — REQ-5; delete `find_minus_hit`,
    `compile_minus_terms`, `AD_MARKERS`, `has_buyer_intent`, `has_soft_ask`, `passes_lead_prefilter`, stem/plus_term
    + their tests — verify `cd telegram-worker && python -m pytest -q`.
- Wave 2 (depends T1+T2 contracts)
  - [ ] T3 `api` [backend] owns `app/api/workspace/route.ts`, `lib/processes/**` (incl. `scan-flow.ts`),
    `lib/security/workspace-authz.ts`, `tests/workspace-authz-map.test.ts`, `lib/workspace-schemas.ts`, deletes
    `lib/lead-core.ts`, `lib/lead-stopwords.ts`, `lib/ai-keywords.ts` auto-minus, `scripts/check-lead-core.ts`,
    `scripts/sanitize-lead-settings.ts`, vitest users of the deleted fixtures, `tests/*route*|lead*` —
    REQ-1..4,9,10,12,14..16,18,19,22..24. Untouched: `lib/lead-conversation.ts`, `lib/lead-search.ts`, `app/api/cron/**`.
  - [ ] T4 `ui` [frontend, ui-builder via /ui-task] owns `components/product/ai/**`, `app/app/page.tsx` (incl.
    «Переписки» filter :625/:1949/:2329), `components/product/overview-dashboard.tsx`, `app/globals.css`
    (`.lead-core-*` removal), `components/product/lead-core-panel.tsx` removal, `tests/ui-*`, e2e spec — REQ-20,25..27.
- Wave 3: integrate, full gate, code-reviewer + security-reviewer + verifier, e2e on the local stand, replay eval.

## Verification plan
| REQ | evidence | command / artefact |
|---|---|---|
| 5 | pytest: no keyword/minus drop, counters incl. `skippedError`, cap 80, 1-day first scan | `telegram-worker/tests/test_scan_raw.py` |
| 6,7,13 | vitest filter (AI-reject memory, empty id) + invariant + grep no regex | `tests/leads/filter.test.ts`, `rg 'BUYER_INTENT_RE\|AD_MARKERS' lib app telegram-worker/src` → 0 |
| 8–11 | vitest judge, fake LLM (valid, invalid→retry, timeout, missing ids, injection, failed batch 2 → cursor = first id − 1, comment ids not in cursor) | `tests/leads/judge.test.ts`, `tests/leads/pipeline.test.ts` |
| 15,16 | vitest DM judge: grouping by userId, 21 senders → 1 call + 1 skipped, failure advances inbox cursor, own account ignored | `tests/leads/dm-judge.test.ts`, `tests/leads-route.test.ts` |
| 1–4,9,12,14,17–19,21,22 | vitest route with D1 fake (lazy default project, scan_day upsert, funnel action, auto draft ≤3 hot, caps) | `tests/leads-route.test.ts` |
| 23,24 | vitest authz map + SERVER_OWNED: generic save of `project` → 403/400, new actions mapped | `tests/workspace-authz-map.test.ts`, `tests/scan-flow.test.ts` |
| 20,25–27 | ui-qa 390/768/1440 + design panel + e2e | `artifacts/ui-qa/lead-core-v2/`, e2e spec |
| Goal | replay 60 labelled stand messages (30/30) via real judge, recall ≥80 %, precision ≥70 % | `scripts/eval-lead-judge.mjs` → `artifacts/lead-eval/` (HUMAN_NEEDED without key) |

## Definition of done
All REQ rows have evidence · local gate green (lint, tsc, vitest, pytest, build) · docs `docs/leads-pipeline.md`
with symbol anchors · STATE/DECISIONS lines · verifier verdict in PR.

## Plan review 2026-10-01
Verdict REVISE → fixed:
- B1 cursor rewind on first failed/skipped batch, ascending ids, group/discussion only → REQ-10, judge/pipeline tests.
- B2 AI-reject memory kept in `duplicate` step → REQ-6, REQ-9.
- B3 `skippedError` (worker `get_sender`, app empty id), events-per-run funnel → REQ-5, REQ-6, REQ-13.
- B4 DM pass grouped by userId, ≤1 call / ≤20 senders, cursor advances on failure → REQ-15, REQ-16, NFRs.
- B5 `SERVER_OWNED` new lead/group fields, `scan-flow.ts` → T3 → REQ-24.
- B6 `scan_day` per project per day + `funnel` action, not in GET → REQ-12, contract; `scan_run` dropped.
- B7 authz rules, project read-only for generic save, authz map test → T3 → REQ-23.
- S1 explicit file fate per task → Plan T1..T4.
- S2 auto draft hot only, ≤3, `after()`, own guard, «Переписки» filter → REQ-18, REQ-20, T4.
- S3 35 s timeout, one retry, cap 80 / ≤4 batches → REQ-8, NFRs.
- S4 project fields only in `project`; `rebuild_product` / `generate_account_about` retargeted → REQ-4.
- S5 uuidv5 via `node:crypto` sha1 → contract. · S6 daily caps as ai_guard day rows → contract.
- S7 own-account detection app-side → REQ-15. · S8 first scan depth 1 day → REQ-5.
- C1 cron REQ dropped, `app/api/cron/**` out of ownership. · C2 lazy default project, no bulk migration → REQ-2.
- C3 one DM call with all projects, A-4 dropped. · C4 temperature dropped, hot = score ≥80 → REQ-8, REQ-9.
- C5 `pendingDraft`/`draftId` dropped, reuse `lead.draft` + `draftKind` → REQ-17, REQ-19.
- C6 examples ≤10 + ≤10 → contract. · C7 T2 = REQ-5 + Python matcher deletion. · C8 `suggest_stopwords` cut → REQ-22.

## Decision log
- 2026-10-01 LLM judge is the only lead gate; cheap filters only drop provably useless messages, all counted (owner
  decision: logic must be understandable; regex cap killed 231/232).
- 2026-10-01 Learning = examples in the prompt, never auto stop words (self-poisoning observed on the stand).
- 2026-10-01 Plan review: funnel as per-day aggregate row instead of per-run records (D1 GET budget); cursor rewinds to
  first unjudged id so a judge outage never loses messages.
- 2026-10-01 Code review: a deterministic poison batch would pin the cursor and burn ~2/3 of the daily cap, so the
  rewind is bounded — schema-invalid answer ×2 skips the batch, 3 failed scans in a row advance the group; both
  counted as `judgeError` and logged. Trade-off: a long judge outage (>3 scans) loses those messages, visibly.
