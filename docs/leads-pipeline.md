# Leads pipeline (lead core v2)

Spec: `docs/project/specs/lead-core-v2.md`. Every human message from a project's groups, channel comments
and incoming DMs is either judged by the project's LLM judge or dropped by a counted cheap filter. There
are no keyword / intent regexes on the lead path; project keywords are only a hint in the judge prompt.

## Data (all in `records`, JSON `data`, every query bound to `owner`)

| kind | id | written by | served by GET |
|---|---|---|---|
| `project` | uuid; default `uuidv5(owner,'unilab-default-project')` | `project_*` actions, `rebuild_product`, `lead_feedback`, lazy default | yes (read-only: generic `save`/`delete` reject it) |
| `group.projectId` | — | group create / `import_catalog` / `set_group_project` / `project_delete` | with the group |
| `lead.projectId/score/reason/sourceKind/draftKind/feedback` | — | scan, DM pass, `draft`, `lead_feedback` | with the lead |
| `scan_day` | `scan-day:<projectId>:<YYYY-MM-DD>`; DM row `scan-day:dm:<owner>:<day>` | each group scan / DM pass | no — action `funnel` |
| `ai_guard` | `judge-day:<owner>:<day>`, `draft-day:<owner>:<day>`, `ai-guard:<owner>` (manual draft 1/min) | caps | no |

- Contract and zod: `lib/leads/projects.ts::projectSchema`, `::projectPatchSchema` (strict field patch).
- A group/lead without `projectId` reads as the default project: `lib/leads/projects.ts::projectIdOf`. The
  default row is created lazily from `settings` (`::ensureDefaultProject`, `INSERT OR IGNORE`) by GET
  (`app/api/workspace/route.ts::ensureOwnerProject`), the first scan or any project action.
- Server-owned fields (a client `save` never sets them): `lib/processes/scan-flow.ts::keepServerOwnedFields`
  (lead `projectId`, `score`, `reason`, `sourceKind`, `draftKind`, `feedback`; group `projectId`; settings
  `inboxPollCursor`, `dmAiRejected`).

## Group scan (`scan_group`)

`app/api/workspace/route.ts` action `scan_group`:
1. Account gate, catalog placeholder, rescan interval, scan lock — unchanged
   (`lib/processes/scan-flow.ts::evaluateScanGate`, `route.ts::acquireGroupScanLock`).
2. Project of the group: `lib/processes/lead-store.ts::findOwnedProject` (deleted project → default).
   An inactive project (`active:false`) skips the scan (`projectInactive:true`).
3. Worker `/scan-group` with `{…session, url, days: project.scanDepthDays, minId: group.scanCursor}`
   (no keywords/limit; REQ-5 lives in `telegram-worker/src/check_account.py::scan_group`).
4. `lib/processes/lead-scan.ts::scanGroupLeads` → `lib/leads/pipeline.ts::runGroupScan`:
   - `lib/leads/filter.ts::filterMessages` — in order: empty id (`skippedErrorApp`), older than
     `scanDepthDays` (`old`), text < 12 (`short`), known fingerprint / tombstone / AI-reject memory / same
     sender+text (`duplicate`), word-start stop word (`stopword`);
   - `lib/leads/judge.ts::judgeMessages` — ascending ids, batches ≤20, ≤4 per scan, daily cap gate
     (`lead-store.ts::reserveDailyCap`, default 3000 messages/day, `settings.judgeDailyCap`), 35 s + 1 retry
     (`lib/ai-client.ts::jsonLlmFrom`, `::deepseekJsonText`); the retry reserves the cap again for the same
     messages (`lib/processes/lead-scan.ts::judgeLlm`), no room → the batch fails as `judgeError`;
   - `isLead && score ≥ minScore` → lead (`hot` when score ≥ `HOT_SCORE` = 80); others → rejected and
     remembered in `group.aiRejected` (`lib/leads/reject-memory.ts`);
   - a failed or skipped batch stops judging: `scanCursor = first unjudged group/discussion id − 1`
     (`pipeline.ts::nextScanCursor`), so nothing is lost; comment ids never reach the cursor.
5. Leads inserted, `scan_day` upserted (`lib/leads/funnel.ts::upsertScanDay`, compare-and-set), group
   metrics/cursor/`aiRejected`/scan log written, notifications flushed (`route.ts::flushLeadNotifications`).
6. Auto drafts: `lead-scan.ts::autoDraftCandidates` (hot leads of projects with `autoDraft`, ≤3) drafted
   after the response (`route.ts::draftAfterResponse` → `next/server` `after()`; outside a request scope the
   task runs detached) by `lead-scan.ts::autoDraftLeads`: each reserves `draft-day` (default 200,
   `settings.draftDailyCap`), never overwrites a typed draft, sets `draft` + `draftKind`, never sends.

Response: `{ok, scanned, fetched, judged, matched, added, addedByTemp:{hot,warm}, projectId, funnel:<counts>,
judgeError, title, metrics, taskLog}` (cron `app/api/cron/auto-rescan/route.ts` reads `added`).

## DM pass (`poll_dm_replies`)

`route.ts::pollDmReplies`: per account `/inbox-dms`; a DM of an open conversation is merged
(`lib/lead-conversation.ts::mergeIncomingDm`); every other DM is collected and judged once per pass by
`route.ts::judgeUnmatchedDms` → `lead-scan.ts::judgeInboxDms` → `pipeline.ts::runDmJudge`:
- own accounts dropped app-side (`lead-scan.ts::loadOwnAccounts`: account `username`, `tgUserId` stored by
  `route.ts::runAccountCheck`), senders that already are leads → `duplicate`;
- ≤20 senders in one call with all active project cards (`lib/leads/dm-judge.ts::judgeDmSenders`; each card
  clipped to 200 chars per field + 200 of keywords, `lib/leads/prompt.ts::DM_CARD_FIELD_MAX`);
  verdict `projectId` + score ≥ that project's `minScore` → lead `sourceKind:'dm'`, `conversationOpen:true`;
- rejections remembered in `settings.dmAiRejected` (key `userId:lastMessageId`);
- judge failure / skip is only counted; account inbox cursors and `inboxPollCursor` advance regardless.
Response adds `dmLeads` (number of DM leads created).

## Funnel counters (`lib/leads/types.ts::FUNNEL_COUNTERS`, events per run)

`fetched = skippedNotUser + skippedOldWorker + skippedError + returned`;
`returned = skippedErrorApp + old + short + duplicate + stopword + judgeSkipped + judgeError + rejected + leads`.
`judged` = messages the judge answered (`rejected + leads`). Each app step keeps the last 3 samples
(text ≤200, `term` for stop words, `reason` for judge steps / skip reason `no_ai_key|daily_cap|blocked|batch_limit|sender_limit|no_project`);
`runs` keeps the last 20 run lines. One row per project per UTC day (`funnel.ts::mergeScanDay`). Retention: after each upsert the owner's
`scan_day` rows with `day` older than 30 days are deleted, at most 100 per run
(`lib/leads/funnel.ts::pruneScanDays`, called by `lib/processes/lead-scan.ts::recordFunnel`).

## Actions (POST `/api/workspace`, authz `lib/security/workspace-authz.ts::ACTION_RULES`)

| action | body | result | section |
|---|---|---|---|
| `project_create` | `{data:{name, …card fields}}` | `{ok,id,project}`; 409 `limitReached` over 10 | ai (write) |
| `project_update` | `{id, patch:{…any card fields}}` (unknown keys → 400) | `{ok,id,project}` | ai (write) |
| `project_delete` | `{id, moveToProjectId?}` | `{ok,id,moved,moveToProjectId}`; 409 `{groups}` when groups exist without target; 400 for the default project | ai (write) |
| `set_group_project` | `{groupIds:[uuid…≤500], projectId}` | `{ok,projectId,updated}` | ai (write) |
| `funnel` | `{projectId, days:1\|7}` | `{ok, funnel:FunnelView, dm:FunnelView}` (`projectId:'dm'`) | ai (read) |
| `rebuild_product` | `{projectId, notes?}` | `{ok,id,project}` — AI fills the card from `url`; stop words untouched | ai (write) |
| `lead_feedback` | `{id, verdict:'good'\|'bad'}` | `{ok,lead,projectId,project}` — example added (FIFO ≤10), `lead.feedback` set | leads |
| `draft` | `{id, kind?:'group_reply'\|'dm_first'\|'dm_continue'}` | `{ok,draft,kind,model}`; 429 by the 1/min guard or the daily cap; manual draft has no `draftKind` | leads |
| `dismiss_draft` | `{id}` | `{ok,lead}` — `draft:''`, `draftKind` removed | leads |
| `send_lead_message` | unchanged | success clears `draft` + `draftKind` | leads |
| `generate_account_about` | `{projectId?, notes?}` | `{ok,about,firstName,lastName,fromAi,projectId}` | accounts |
| `import_catalog` / `save kind:'group'` (new) | `projectId?` | groups get that project, else the default | groups |

Staff without `leads`/`chats` access (e.g. ai or settings only) never get lead/DM texts: funnel `samples`
and project `goodExamples`/`badExamples` are emptied in GET and in project/funnel answers, and such staff
cannot patch the examples (`lib/security/workspace-authz.ts::redactLeadTextFor`, `::canSeeLeadText`).
Account `tgUserId` is server-owned (a generic account save keeps it).

Every `projectId` is checked against the owner (`lead-store.ts::findOwnedProject`; foreign → 404).
Removed (unknown → 400): `preview_lead_core`, `train_from_hot`, `train_from_ignored`,
`reject_lead_stopwords`, `suggest_stopwords`.

## Tests

`tests/leads/**` (pure modules), `tests/leads-route.test.ts` (route + sqlite D1 fake),
`tests/lead-scan-route.test.ts`, `tests/scan-leads.test.ts`, `tests/workspace-authz-map.test.ts`.

## Evaluation

`scripts/eval-lead-judge.mts` replays `tests/fixtures/lead-eval/messages.json` (60 messages: 30 `lead`,
30 `not_lead`, each tagged `source` real|synthetic and a `category`) through `lib/leads/judge.ts::judgeMessages`
with the real DeepSeek call (`lib/ai-client.ts::aiChatJson`). The card is `tests/fixtures/lead-eval/project.json`
(stand `settings` subset) mapped by `lib/leads/projects.ts::defaultProjectFromSettings`; a message counts as
predicted lead when `isLead && score >= minScore`, as in `pipeline.ts::runGroupScan`. Targets: recall ≥80 %,
precision ≥70 % (exit 0 met, 1 below, 2 no key / bad input).

```sh
npx tsx --env-file=<stand .env with AI_API_KEY> scripts/eval-lead-judge.mts [--old-core <scratch lead-core.ts>]
```

Output: confusion matrix, recall, precision, misses; per-message verdicts in `artifacts/lead-eval/<date>.json`
(untracked). `--old-core` scores the same messages with the removed regex core (`lib/lead-core.ts` from git
history, `lead-filter` import made relative) for comparison.

Fixture provenance: the 30 negatives are 27 real stand messages (old hot/warm/cold leads: seller questions,
complaints, vacancies, spam, service ads, vendor research, news) and 3 synthetic hard negatives; the stand had
no unambiguous real lead, so the 30 leads are synthetic. Names, usernames and links are replaced by
placeholders. Run 2026-10-01 (deepseek-chat, 3 calls): new judge 30/0/0/30 (recall 100 %, precision 100 %;
lead scores ≥80, negatives ≤20); old core recall 46.7 % (14/30), precision 82.4 %.
