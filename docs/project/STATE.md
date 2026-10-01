# STATE (partial — task note only; regenerate via /project-sync)

## Now
- task/chats-first-contact-tg-bot-2026-10-01 (worktree ~/worktrees/wt-unilab-chats-first-contact-tg-bot-2026-10-01), head pushed.
  First contact in «Переписки», awaited bot notices (root cause: fire-and-forget notify on workerd), reply from bot.
  Gate: vitest 701/701, tsc 0 new, build ok; live Bot API NOT verified. Handoff: docs/project/tasks/handoff-2026-10-01-8a58f5ff.md
- task/remove-lead-ignore-stopwords-2026-10-01 (worktree ~/worktrees/wt-unilab-remove-lead-ignore-stopwords), commit 260664e pushed.
  Removes lead ignore / stop-word learning. Gate: vitest 670/670, tsc 0 new, build ok; UI NOT verified visually.
  Handoff: docs/project/tasks/handoff-2026-10-01-9cb70af9.md

## Blockers
- PR not opened (no `gh`): task/chats-first-contact-tg-bot-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/chats-first-contact-tg-bot-2026-10-01).
- PR not opened: no `gh` on this machine. Owner: open PR task/remove-lead-ignore-stopwords-2026-10-01 → dev
  (https://github.com/RodionRay/unilab/compare/dev...task/remove-lead-ignore-stopwords-2026-10-01),
  body must include `design-panel: n/a — removal-only change`.
- Owner decision: port to stand wt-uniseller-local-stand or not.
