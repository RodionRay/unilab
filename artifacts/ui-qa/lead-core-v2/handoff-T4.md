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
