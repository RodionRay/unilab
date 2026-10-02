# STATE (partial — task note only; regenerate via /project-sync)

## Now
- task/tg-mini-app-2026-10-01 (worktree ~/worktrees/wt-unilab-tg-mini-app-2026-10-01): Telegram Mini App built, reviews done
  (security NO_BLOCKERS, verifier gap REQ-L4 admin UI → D-8). Not pushed; PR body `.git-pr-body.md`. Stand staff-test 959df2d.
  Handoff: docs/project/tasks/handoff-2026-10-02-tg-mini-app.md; round 2 review fixes a5d187d..2844e80 (vitest 917/917),
  stand 8f62a4b; next: owner phone smoke, push + PR (.git-pr-body.md); then full task «one platform bot» (D-12) —
  docs/project/tasks/handoff-2026-10-02-a9897780.md
- task/chats-first-contact-tg-bot-2026-10-01 (worktree ~/worktrees/wt-unilab-chats-first-contact-tg-bot-2026-10-01), head pushed.
  First contact in «Переписки», awaited bot notices (root cause: fire-and-forget notify on workerd), reply from bot.
  Gate: vitest 701/701, tsc 0 new, build ok; live Bot API NOT verified. Handoff: docs/project/tasks/handoff-2026-10-01-8a58f5ff.md
- task/remove-lead-ignore-stopwords-2026-10-01 (worktree ~/worktrees/wt-unilab-remove-lead-ignore-stopwords), commit 260664e pushed.
  Removes lead ignore / stop-word learning. Gate: vitest 670/670, tsc 0 new, build ok; UI NOT verified visually.
  Handoff: docs/project/tasks/handoff-2026-10-01-9cb70af9.md

## Blockers
- Owner: push + PR task/tg-mini-app-2026-10-01 → dev; test bot token for real-phone mini app smoke.
- PR not opened (no `gh`): task/chats-first-contact-tg-bot-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/chats-first-contact-tg-bot-2026-10-01).
- PR not opened: no `gh` on this machine. Owner: open PR task/remove-lead-ignore-stopwords-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/remove-lead-ignore-stopwords-2026-10-01),
  body must include `design-panel: n/a — removal-only change`.
- Owner decision: port to stand wt-uniseller-local-stand or not.
