# Decisions

- 2026-10-02 · «Переписки» UI: new product components in `components/product/chats/` (ChatsPanel, ChatList,
  ChatHeader, ChatThreadView, ChatComposer, ChatTick, ChatAvatar) — no existing screen had a messenger layout; they
  reuse the kit (`avatar`, `bubble`, `marker`, `textarea`, `tabs`, `dropdown-menu`, `button`, `empty`, `skeleton`,
  `input`). `message-scroller` is not used: the thread must open at the unread divider, which its API does not expose;
  a plain scroll container with two effects does it. Spec: `docs/project/specs/tg-chat-ui.md`.
- 2026-10-02 · Chat palette is scoped (`--chat-*` under `[data-chat-theme]`), not a global light theme: the app stays
  dark-only; the light chat surface follows Telegram Desktop.
