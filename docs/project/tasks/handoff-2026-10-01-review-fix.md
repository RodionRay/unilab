# Handoff — lead-core-v2 review fixes (worker sessions, 2026-10-01)

Goal: fix the code-review findings (P2 1–6, P3 7–10) of lead-core-v2 + assistant product source; RED test first,
commit + push per item. Worktree `~/worktrees/wt-unilab-lead-core-v2-2026-10-01-review-fix`, branch
`task/lead-core-v2-2026-10-01-review-fix-2026-10-01` (pushed). Base integration `task/lead-core-v2-2026-10-01`
merged at 8529008 (UI round 6 + docs). No PR yet.

## Done — all items (gate: vitest 646/646, tsc 18 = base 18, eslint touched files = base counts
## (route 59, page 28, rest 0), `npm run build` exit 0, pytest 39/39 via scratchpad venv)
- 1 ffaff95 draft regen keeps draftKind.
- 10 e8dad70 `lead-store.ts::findProjectOf` (missing project → default).
- 2 1ca2008 settings save never writes project fields.
- 3 a14f747 `judge.ts::UnjudgedMessage.rewind` / `::callFailure` (invalid JSON / schema after retry → judgeError,
  no rewind); `pipeline.ts::decideCursor` + `JUDGE_FAIL_STREAK_MAX=3`; `group.judgeFailStreak` server-owned;
  route writes streak + Russian `warn` to scanLog and rescanLog.
- 6 d4d9107 `judge.ts::JUDGE_DEADLINE_MS` (90 s, `JudgeOptions.clock/deadlineMs`), skip reason `deadline`.
- 8 b33f3ad `types.ts::JudgeLlm` (units arg); `lead-scan.ts::judgeLlm` per call; `judgedUnits` deleted.
- 7 c838b91 `pipeline.ts::workerFetched`; mismatch note «расхождение: воркер собрал N, по счётчикам M».
- 4 6eb2558 `route.ts::loadConversationLeads` matches any lead of the peer (started conversation first).
- 5 641bdae `lead-scan.ts::leadsWhereIn` (IN chunks ≤50), `::loadKnownFingerprints`, `::loadKnownSenderIds`,
  `::loadPeerLeads`; conversation leads loaded per account.
- 9 6e1962b `page.tsx::moveGroupsToProject`, per-row select + «В проект…» bulk select (≥2 projects).
- assistant fd34e7f `app/api/assistant/route.ts::loadOwnerProduct` → default project.

## Decisions taken (orchestrator may revisit)
- Item 3 "failed scan" = a rewinding `judgeError` (transient call error / gate throw). daily_cap / no_ai_key
  scans that judged nothing keep the streak (waits, not failures); deadline never counts.
- "Schema-invalid twice" is detected from the last error of `jsonLlmFrom` (lib/ai-client.ts not owned): a 5xx
  then an invalid answer also counts as invalid.

## Open for the orchestrator (not owned)
- `components/product/ai/model.ts::SKIP_REASON_LABEL` lacks `deadline` (UI shows the raw key).
- UI of item 9 NOT visually QA'd (no screenshots); source tests only.
