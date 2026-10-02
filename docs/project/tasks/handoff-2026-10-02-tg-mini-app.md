# Handoff 2026-10-02 — Telegram Mini App (task/tg-mini-app-2026-10-01)

Goal: Telegram Mini App for UniLab (spec `docs/project/specs/tg-mini-app.md`, owner answers = defaults).
Took over from session 7597ec7f after the 2026-10-01 laptop crash.

## Done
- Subtasks merged into integration: tma-auth, tma-ui (before crash), tma-bot 9f5628d, tma-settings 08f2d5b (both were complete; workers died after committing).
- Review round: code-reviewer CHANGES_REQUESTED, security NO_BLOCKERS (M1 Host-derived URL, 2 LOW), design FIX → fixed in
  `task/tg-mini-app-2026-10-01-fix-api` + `-fix-ui` (merged), contract step 016cf58, e2e flake fix 3942bcb, docs f6a3e5f.
- Re-review: security NO_BLOCKERS, design PASS, verifier GAPS_FOUND only REQ-L4 admin-unlink UI → v1.1 (D-8). D-4..D-8 recorded.
- Gates: vitest 899/899, build ok, tsc 45 / lint 256 = baseline, e2e 68+10 x3.
- Stand: uniseller `local/staff-test-2026-10-01` ff → 959df2d (port branch `local/staff-test-tma-port-2026-10-02`,
  migration renamed `0005_tma.sql`, glue security NO_BLOCKERS), D1 backup `artifacts/backup-20261002-0521*-pre-tma`,
  migrated, web restarted (pid in logs/web.pid), smoke via https://mesa-delight-lanes-commonly.trycloudflare.com ok.

## Next (owner)
1. Push `task/tg-mini-app-2026-10-01` (not pushed, ~60 commits) and open PR → dev with `.git-pr-body.md`; merge after/superseding the bot branches.
2. Dedicated test bot token → set in a test workspace, `node scripts/tma-dev.mjs` sets the menu button, real-phone smoke (iOS/Android/Desktop).
3. After merge: remove worktrees wt-unilab-tg-mini-app-{auth,ui,bot,settings,fix-api,fix-ui}.

## Follow-ups (v1.1)
Admin unlink button in «Сотрудники» (D-8); force-resend after unknown send (D-7); shared bot token linking (D-4);
atomic peek+consume rate limits (LOW); design minors (FAB overlap at 390, unknown-send tone amber, duplicate «Открыть бота»).
