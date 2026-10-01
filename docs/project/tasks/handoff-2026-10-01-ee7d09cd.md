# Handoff 2026-10-01 — auto-rescan starvation (ee7d09cd)

Goal: auto-rescan scanned 0 groups per tick on staff-test (worker.log `scanned=0 due=46..142`).
Cause: `rescan_groups` ordered by `lastScanned`; scan_group soft-fail (needDiscussionJoin / fresh join) never set
it → those groups (21 on staff-test) always first, limit 6 eaten by 409s, the other 68 joined groups never auto-scanned.
Fix: `lib/rescan-queue.ts::lastRescanTouch/rescanNotDue` (max of lastScanned, scanTriedAt); soft path writes `scanTriedAt`.
Test: `tests/rescan-queue.test.ts` (RED without scanTriedAt, GREEN with). Gate: vitest 59 files/676, lint clean on new
files, tsc no new errors (45 pre-existing), build ok.
Branch: task/fix-rescan-starvation-2026-10-01, worktree ~/worktrees/wt-unilab-fix-rescan-starvation. PR: owner opens (no gh).
Next: port to staff-test (~/worktrees/wt-uniseller-staff-test, route.ts rescan_groups + soft path), build, restart web
per RUNBOOK.local.md, watch worker.log for `scanned>0`.
