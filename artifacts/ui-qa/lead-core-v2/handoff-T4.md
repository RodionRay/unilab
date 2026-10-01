# Handoff T4 (UI) lead-core-v2: resume 3 (2026-10-01)
Done: 8c37100 dead rules dropped; 656eca8 `.aiw-*` styles (all classNames styled); dffca42 round 2 fixes.
Rounds: r1, r2 in `artifacts/ui-qa/lead-core-v2/rounds/` (notes.md each). Best = r2. Servers stopped.
Next: r3 per `rounds/r2/notes.md` (alert grid on mobile, «Лиды» row above the fold, queue link alignment/sticky);
identify ui-qa A4 (<24px) / A10 (390 inputs <16px) offenders; final after/ captures incl. `staff-redacted` + states.mjs.

# Handoff T4 (UI) lead-core-v2: resume 2 (2026-10-01), stopped at context threshold before CSS
Branch `task/lead-core-v2-2026-10-01-ui-2026-10-01`, worktree `/Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui`.

## Done in resume 2 (pushed: ff500d7, 385870d)
- Redaction: `model.ts::canSeeLeadText/canSeeGroups/patchForViewer/isRowExpandable/showRedactedSamplesNote`; page passes
  `leadTextVisible`/`groupsVisible` from GET `workspace` (`workspaceMeta`); funnel rows without samples are not expandable,
  note `.aiw-redacted-note`; examples → `.aiw-locked` «Примеры видны только с доступом к лидам», patch never carries examples;
  queue for such staff → «Черновики видны сотрудникам с доступом к лидам»; staff without groups → funnel still requested (`groupCount:null`).
  Tests: `tests/ui-ai-workspace.test.ts` (7 pass). tsc: 0 errors in owned files.
- Harness: real contract shapes, draftKind real kinds (manual draft has none), scenario `staff-redacted` (`fixtures.mjs::STAFF_WORKSPACE`,
  proxy 403 + log on examples patch / lead actions). README updated.

## Next (exact)
1. globals.css: delete dead rules (verified unused in app/ components/ via grep): `.ai-layout` (≈1825 + responsive ≈3361, 3374), `.ai-block*`,
   `.ai-filter-grid/-card*` (+ responsive ≈3377), `.ai-last-minus*`, `.kw.minus.is-new`, `.kw.plus/.minus/.niche` (≈1932-1946),
   `.ai-tips*` (≈2030-2050), `.lead-core-*` (≈4915-4960+). KEEP `.kw`, `.kw-list`, `.kw-editor*` (term-fields uses `.kw-editor .kw`), `.ai-assistant-widget`.
2. Write `.aiw-*` (list below + new `aiw-redacted-note`, `aiw-locked`, `aiw-count`, `aiw-score`, `aiw-queue-row/-who/-name/-snippet/-list`,
   `aiw-draft-head/-name/-foot/-actions`, `aiw-link-btn`, `aiw-muted`, `aiw-inline`, `aiw-banners`, `aiw-page-error`, `aiw-alert-title`,
   `aiw-dm-main/-sum/-steps`, `aiw-row-chevron`, `aiw-first-copy`, `aiw-save-state`, `aiw-empty-title`, `is-compact`, `is-static`, `is-small`) with
   `--spike-*` tokens only; get the full list: `grep -oh 'aiw-[a-z0-9-]*' components/product/ai/*.tsx | sort -u`.
3. Rounds r1..r3 (task step 4), final after/ captures incl. `staff-redacted` + `harness/states.mjs` (task step 5); stop servers (`harness/serve.sh --stop`).

# Handoff T4 (UI) lead-core-v2 — 2026-10-01, stopped at context threshold
Worktree `/Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui`, branch `task/lead-core-v2-2026-10-01-ui-2026-10-01` (pushed), head 52eac86.

## Done (committed)
- `components/product/ai/`: `model.ts` (contract types + pure helpers: funnelRows/funnelResidual/funnelHeadline, diffProjectPatch,
  projectIdOf, approvalQueue, isAwaitingApproval, isInConversations, sendModeFor, addStopWord/addExample), `api.ts`,
  `use-active-project.ts` (URL `project` → sessionStorage → oldest project), `ai-workspace.tsx`, `project-switcher.tsx`
  (+NewProjectDialog), `funnel-panel.tsx`, `approval-queue.tsx`, `project-card-editor.tsx`, `term-fields.tsx`, `delete-project-dialog.tsx`.
- `app/app/page.tsx`: AI block → `<AiWorkspace/>`; Kind gains read-only `project`; LeadCorePanel, KeywordChips, settings product/keyword
  modal, training handlers (train_from_*, reject_lead_stopwords, set/bulk_set_lead_training_exclude, preview) removed; page `rebuildProduct`
  removed (card calls `rebuild_product {projectId}`); Leads: project select (shared active project + «Все проекты»), «Хороший лид»/«Не лид»
  → `lead_feedback`; «Переписки» + overview draft count use `isInConversations` (REQ-20). `lead-core-panel.tsx` deleted.
- tsc: 0 errors in owned files.
- Funnel mapping: Собрано=fetched; Боты и каналы=skippedNotUser (added so rows sum to fetched); Старые=skippedOldWorker+old; Короткие=short;
  Повторы=duplicate; Стоп-слова=stopword; Без оценки=judgeSkipped; Ошибка AI или чтения=judgeError+skippedError+skippedErrorApp; Не лид=rejected; Лиды=leads.

## Next steps (not done)
1. globals.css: remove `.lead-core-*`, `.ai-layout/.ai-block/.ai-filter-*/.ai-last-minus/.ai-tips*`, `.kw.plus/.kw.minus/.kw.niche/.is-new`;
   add `.aiw-*` styles (classes used in components/product/ai/*.tsx: aiw, aiw-switcher/tabs/tab/tab-count, aiw-top grid 7fr/5fr ≥1200px,
   aiw-panel-head, aiw-segment, aiw-headline(+is-lead amber), aiw-ledger/row/row-main/row-label/row-name/row-hint/row-figures/row-count/
   row-share/row-bar[data-tone], aiw-samples/sample, aiw-dm*, aiw-alert(.is-warning/.is-error), aiw-empty, aiw-queue*, aiw-draft*, aiw-source,
   aiw-why, aiw-card, aiw-group (fieldset+legend), aiw-grid-2, aiw-field/label/label-row/help/counter/field-error, aiw-chips, aiw-examples,
   aiw-example-list/add, aiw-setting, aiw-range, aiw-number, aiw-savebar (sticky), aiw-first(+preview), aiw-skeleton*).
2. Fix harness `fixtures.mjs` draftKind 'auto' → 'group_reply'/'dm_first'.
3. tests/ui-ai-workspace.test.ts (model helpers) + extend tests/ui-risky-features-removed.test.ts (removed actions, panel absent).
4. harness e2e-ai.mjs (playwright from ~/Projects/crm-spa) + log; ui-qa rounds r1..r3 → after/<scenario>; gate (vitest, eslint, tsc, build).
