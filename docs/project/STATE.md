# STATE (partial — task note only; regenerate via /project-sync)

## Now
- task/manual-lead-triage-2026-10-02 (worktree ~/worktrees/wt-unilab-manual-lead-triage-2026-10-02), «Лиды» manual triage,
  spec specs/manual-lead-triage.md. Gate: vitest 690/690, tsc/eslint no new, build ok, e2e/lead-triage.e2e.mjs PASS
  (prod build, 1280+390); code-review + security fixes in 06fe93c, verifier PASSED. Ported to staff-test 422ad9b.
- task/remove-lead-ignore-stopwords-2026-10-01 (worktree ~/worktrees/wt-unilab-remove-lead-ignore-stopwords), commit 260664e pushed.
  Removes lead ignore / stop-word learning. Gate: vitest 670/670, tsc 0 new, build ok; UI NOT verified visually.
  Handoff: docs/project/tasks/handoff-2026-10-01-9cb70af9.md

## Blockers
- PR not opened (no `gh`): owner opens https://github.com/RodionRay/unilab/compare/dev...task/manual-lead-triage-2026-10-02
  (body: spec link + `design-panel: screenshots artifacts/manual-lead-triage, small edit to existing screen`).
- PR not opened: no `gh` on this machine. Owner: open PR task/remove-lead-ignore-stopwords-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/remove-lead-ignore-stopwords-2026-10-01),
  body must include `design-panel: n/a — removal-only change`.
- Owner decision: port to stand wt-uniseller-local-stand or not.
