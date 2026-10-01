# STATE (partial — task note only; regenerate via /project-sync)

## Now
- task/fix-rescan-starvation-2026-10-01 (worktree ~/worktrees/wt-unilab-fix-rescan-starvation): auto-rescan starved on
  soft-failed groups (scanned=0 every tick). Fix: scanTriedAt + lib/rescan-queue.ts. Handoff: docs/project/tasks/handoff-2026-10-01-ee7d09cd.md
- task/remove-lead-ignore-stopwords-2026-10-01 (worktree ~/worktrees/wt-unilab-remove-lead-ignore-stopwords), commit 260664e pushed.
  Removes lead ignore / stop-word learning. Gate: vitest 670/670, tsc 0 new, build ok; UI NOT verified visually.
  Handoff: docs/project/tasks/handoff-2026-10-01-9cb70af9.md

## Blockers
- PR not opened (no `gh`): owner opens task/fix-rescan-starvation-2026-10-01 → dev. Ported to staff-test 352162d; tick scanned>0 NOT verified yet.
- PR not opened: no `gh` on this machine. Owner: open PR task/remove-lead-ignore-stopwords-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/remove-lead-ignore-stopwords-2026-10-01),
  body must include `design-panel: n/a — removal-only change`.
- Owner decision: port to stand wt-uniseller-local-stand or not.
