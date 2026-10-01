# Handoff — lead-core-v2 review fixes (worker session 2109fc5c, 2026-10-01)

Goal: fix the code-review findings (P2 1–6, P3 7–10) of lead-core-v2; RED test first, commit + push per item.
Worktree `~/worktrees/wt-unilab-lead-core-v2-2026-10-01-review-fix`, branch
`task/lead-core-v2-2026-10-01-review-fix-2026-10-01` (pushed, tracks its own remote name; base integration
`task/lead-core-v2-2026-10-01` @ 364795f). No PR yet. Owned files: route.ts, lib/leads/**, lib/processes/**,
app/app/page.tsx (settings form + groups view), tests/**, telegram-worker/tests/**, docs/leads-pipeline.md.
NOT owned: components/product/ai/**, app/globals.css, ai-assistant-widget.tsx, lib/ai-client.ts.

## Done (head 1ca2008, vitest 620/620, tsc 18 errors = base 18, eslint page/route = base counts, lib/processes 0)
- 1 ffaff95 draft regen keeps draftKind (`route.ts` draft action `{...cur,draft}`) — test in leads-route.
- 10 e8dad70 `lead-store.ts::findProjectOf` (missing project → default) in draft, scan_group, leadFeedback, autoDraftLeads.
- 2 1ca2008 settingsSchema trimmed; `scan-flow.ts::LEGACY_PROJECT_SETTINGS` server-owned; page settings defaults,
  depth input, save payload (`kept` pick), «Подобрать по AI» reads active project. Tests: leads-route + new
  `tests/ui-workspace-page-projects.test.ts`.

## Next (designs already decided)
- 3 stuck batch: in `judge.ts` add `rewind:boolean` to UnjudgedMessage/BatchStop; invalid answer
  (`/^AI: answer (is not valid JSON|fails the schema)/` of the last error) → judgeError, rewind=false (cursor moves
  past); every other error/skip → rewind=true; still stop judging after any failure (later batches `blocked`, rewind).
  `pipeline.ts::nextScanCursor` uses only rewind=true. Group `judgeFailStreak` (add to SERVER_OWNED group): failed scan
  = some rewind unjudged with reason ≠ batch_limit; streak≥3 → use worker cursor, reset 0, return a note that
  route pushes to scanLog ('warn'). Update pipeline tests 'rewinds…batch 2 fails' and 'ignores comment ids' to a
  transient `new Error('DeepSeek 503')` (behaviour change, not weakening); add schema-fail-moves-past test.
- 4 `route.ts::pollDmReplies`/`loadConversationLeads`: match any lead with same peer (prefer open conversation) →
  `recordIncomingDm` (mergeIncomingDm opens it) instead of the judge. Existing test 'a sender that already is a
  lead is not judged again' should also assert the DM merged.
- 5 bounded reads: `lead-scan.ts::loadKnownLeads(db,owner,{groupId,tgMsgIds})` with
  `CAST(json_extract(data,'$.groupId') AS TEXT)=? AND CAST(json_extract(data,'$.tgMsgId') AS TEXT) IN (…)`
  chunks ≤50; DM: senderId IN (…) chunks ≤50; conversation leads per account by senderId/peerId IN msg userIds.
  Only index is (owner,kind) — no migration (spec non-goal). Test: wrap `cfModule.env.DB` counting rows of
  lead SELECTs with 150 seeded leads.
- 6 judge deadline 90 s: `JudgeOptions.clock`/`deadlineMs` (default Date.now/90_000), checked before each batch;
  remaining → judgeSkipped 'deadline' (add to JudgeSkipReason), rewind. Fake-clock test.
- 7 `pipeline.ts` counts.fetched = worker `fetched` when reported (else sum); Russian mismatch note in run line
  instead of "(worker fetched N)"; invariant test in vitest + `telegram-worker/tests/test_scan_raw.py`
  (pytest via venv in session scratchpad, never system pip).
- 8 `lib/leads/types.ts` `JudgeLlm = <T>(schema,prompt,units:number)=>Promise<T>`; judge/dm-judge pass
  batch.length; `lead-scan.ts::judgeLlm` builds `jsonLlmFrom(text,1,()=>gate(units))` per call; delete `judgedUnits`.
- 9 page.tsx groups view: per-group project `<Select>` → `set_group_project` (only when projects.length≥2) +
  bulk action in `groups-actionbar` for `groupSelected`. Source test in ui-workspace-page-projects.
- Gate: `npx vitest run`, `npx tsc --noEmit` (base 18), eslint touched files vs base, `npm run build`, pytest.
  Update docs/leads-pipeline.md per item.

## Open questions for the orchestrator
- `app/api/assistant/route.ts::loadOwnerProduct` still reads `settings.product` (not owned) — should read the project.
- Item 3: unknown non-schema errors (e.g. 401/402) are treated as transient (rewind, bounded by the 3-scan streak).
