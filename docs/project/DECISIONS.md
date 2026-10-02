# Decisions

- 2026-10-02 · «Переписки» UI: new product components in `components/product/chats/` (ChatsPanel, ChatList,
  ChatHeader, ChatThreadView, ChatComposer, ChatTick, ChatAvatar) — no existing screen had a messenger layout; they
  reuse the kit (`avatar`, `bubble`, `marker`, `textarea`, `tabs`, `dropdown-menu`, `button`, `empty`, `skeleton`,
  `input`). `message-scroller` is not used: the thread must open at the unread divider, which its API does not expose;
  a plain scroll container with two effects does it. Spec: `docs/project/specs/tg-chat-ui.md`.
- 2026-10-02 · Chat palette is scoped (`--chat-*` under `[data-chat-theme]`), not a global light theme: the app stays
  dark-only; the light chat surface follows Telegram Desktop.
- 2026-10-02 · REQ-1 amended (owner-approved): two panes when the chats container is ≥700px wide; narrower (768 with
  the app sidebar open, phones) = one column, list → chat with ← back / Esc. Container query, not viewport, because
  the app sidebar takes 270px at 768–1023.
- 2026-10-02 · Light theme is scoped to the «Переписки» workspace (toggle «Светлая тема переписок»); the app stays
  dark-only, a global light theme is out of scope.
- 2026-10-02 · Help widget (AI assistant FAB) stays bottom-right as on every page (WCAG 3.2.6); on this screen it is
  icon-only at ≥768px and the composer keeps an 84px right gutter so it never covers send. Hidden while a chat is
  full-screen on phones (the chat is a modal-like surface there).
- 2026-10-02 · «Добавить лид» returns as a compact button in the chats list header (same `open('lead')`).
- 2026-10-02 · Seed handles stay obviously synthetic (`demo_*`): realistic handles may belong to real people and the
  repo is public. `scripts/seed-demo-chats.mjs` refuses non-local `DEMO_URL`.
- 2026-10-02 · Reply quote keeps the left accent bar: it is Telegram's native reply pattern, not decoration.
