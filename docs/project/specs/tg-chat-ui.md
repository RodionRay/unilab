---
status: in-progress
size: full
model: session model (inherit)
budget: 600M tokens
branch: task/tg-chat-ui-2026-10-01
---
# «Переписки» as a Telegram-style messenger

Owner GO 2026-10-01: redo the lead conversation page to look and behave like Telegram (reference: Telegram Web A /
Desktop). Behaviour and data stay: sending from the lead's account (`send_lead_message`), AI draft (`draft`),
mark-viewed on open (`mark_lead_viewed` + `lib/lead-conversation.ts::markLeadOpened`), inbox polling, filters
«Новые / Просмотренные», search, the bot deep link `/app?view=chats&lead=<uuid>` (staff branch) → `openLead`.

## Before
List of lead rows + modal Dialog with thread and composer (`app/app/page.tsx` `renderLeads` + `<Dialog open={!!detail}>`).

## Requirements (EARS)
- REQ-1 Layout: WHEN view = «Переписки» on ≥768px THE page SHALL show a dialog list (left, ~340px) and the open chat
  (right) side by side, without a modal. The Dialog stays for «Лиды».
- REQ-2 List item: avatar (initials, stable colour by lead id), name, last message preview («Вы: » for ours,
  «Черновик: » for an unsent AI draft), time label (HH:mm today · «вчера» · weekday within 7 days · dd.MM.yy),
  unread count badge for unviewed leads (client messages after our last message, ≥1), failed-send marker.
- REQ-3 List tools: search field (name, @username, text) and folder tabs «Новые (n)» / «Просмотренные (n)» bound to
  the existing filter state; sort as today (needsManager first, then last activity desc).
- REQ-4 Chat header: avatar, name, subtitle = @username · source group · «через <account>»; slot
  `[data-slot=chat-header-badges]` for external badges (account penalty badge lands there); actions: theme toggle,
  open in Telegram, menu (Правки, Копировать текст, Удалить).
- REQ-5 Thread: source message first (theirs, with «Открыть исходное» link), then replies; ours right, theirs left;
  date separators (Сегодня / Вчера / d MMMM); consecutive messages of one side within 5 min grouped (tail only on
  the last); time inside each bubble; outgoing status icon: pending = clock, sent = ✓, read = ✓✓ (inferred: a
  client message exists after it — no read receipts in data), failed = red ! with the error text.
- REQ-6 Reply quote: an outgoing message sent in mode «chat» shows a quote of the source post (reply in the group).
- REQ-7 Scroll: on open scroll to the unread divider «Непрочитанные сообщения» (unviewed lead) else to bottom; on a
  new message keep bottom if the user was near bottom; «вниз» button when scrolled up.
- REQ-8 Composer: auto-growing multiline textarea, Enter = send, Shift+Enter = newline (IME composition safe),
  send disabled while empty/sending; mode toggle: «Ответ в чат» shows a reply bar quoting the source post (× = back
  to личка); AI draft button fills the composer (existing `draft`).
- REQ-9 Themes: chat surface has dark (default, matches the app) and light palettes, toggle persisted in
  localStorage `unilab.chatTheme`.
- REQ-10 Mobile 390px: list only → tap opens the chat full-screen with a back button; back returns to the list.
- REQ-11 States: loading, empty list («Нет диалогов»), no chat selected, empty thread, long names/text wrap,
  disabled send for viewer role.
- REQ-12 Tests: unit tests for the pure view model (`lib/chat-view.ts`); e2e journey (Playwright) open → read →
  type → Enter sends → bubble with status; mobile back navigation.

## Out of scope
Real read receipts, media, avatars from Telegram, per-message reply-to (not stored); a global light theme.
