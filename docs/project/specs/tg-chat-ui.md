---
status: implemented (awaiting UI panel)
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

## Status (2026-10-02)
REQ-1..REQ-12 implemented on `task/tg-chat-ui-2026-10-01`. Evidence: `tests/chat-view.test.ts` (view model),
`e2e/chats.spec.ts` (journey), screenshot rounds in `artifacts/ui-qa/tg-chat-ui/round-*` (not committed).
Known limits: the source post has no stored timestamp (lead creation time is used; hidden when it is later than the
first reply); «прочитано» (✓✓) is inferred from a later client message; incoming messages that arrive while a chat is
open re-mark it unread until it is reopened (no auto mark-viewed on poll).

## Component map
- View model (pure): `lib/chat-view.ts` — `buildThread` (date separators, 5-minute grouping, ticks, reply quote,
  unread divider, optimistic pending), `chatListItem` (preview prefixes, time label, unread count, failed flag),
  `unreadCountOf`, `unsentDraft`, `listTimeLabel`, `dateSeparatorLabel`, `initials`, `avatarTone`, `isSendShortcut`.
- Shell: `components/product/chats/chats-panel.tsx::ChatsPanel` — two panes, narrow container (<700px) = one column
  with back; keeps an opened «Новые» chat in place while it is open; captures the unread state at click time
  (opening marks the lead viewed in the same render); optimistic pending bubble while `sending`.
- `chat-list.tsx::ChatList` (search, folder tabs «Новые/Просмотренные», rows, skeleton, empty states),
  `chat-header.tsx::ChatHeader` (badges slot `[data-slot=chat-header-badges]`, theme toggle, open in Telegram,
  ⋮ Правки / Копировать / Удалить), `chat-thread.tsx::ChatThreadView` (scroll to divider or bottom, keep bottom on new
  messages, «вниз» button), `chat-composer.tsx::ChatComposer` (Enter/Shift+Enter, reply bar for «Ответ в группе»,
  AI draft), `chat-theme.ts::useChatTheme` (localStorage `unilab.chatTheme`), `chat-ticks.tsx::ChatTick`,
  `chat-avatar.tsx::ChatAvatar`.
- Wiring: `app/app/page.tsx` — `<ChatsPanel>` for view «Переписки» (active chat = `detail`, callbacks =
  `openLead` / `sendLeadReply` / `draft` / `open('lead')` / `setDeleting`); the `<Dialog open={!!detail&&view!=='Переписки'}>`
  stays for «Лиды»; `navigate` clears `detail`. Read-only = staff role `viewer`.
- Styles: `app/globals.css` section «Переписки — Telegram-style chats» — `--chat-*` palette under
  `[data-chat-theme=dark|light]`, full-bleed workspace via `.workspace:has(> [data-chats-panel])`.
- Test hooks: `data-chat-item` + `data-lead-id` (+ `data-unread`), `data-chat-thread`, `data-chat-msg` with
  `data-side=out|in` and `data-status=pending|sent|read|failed|unknown|received`, `data-unread-divider`,
  `data-chat-composer`, `data-chat-send`, `data-chat-back`.

## Running the checks
- Unit: `npx vitest run tests/chat-view.test.ts` (part of `npm test`).
- E2E (`npm run test:e2e`, `playwright.config.ts`, chromium): needs a running production server
  (`npm run build && cp .env dist/server/.dev.vars && npm run start -- --port 5481`) and the synthetic seed in a local,
  disposable cabinet: `DEMO_URL=http://127.0.0.1:5481 DEMO_PASSWORD=<admin password> node scripts/seed-demo-chats.mjs`
  (run on an empty local D1; it only adds fictional records). Env: `E2E_BASE_URL` (default `http://127.0.0.1:5481`),
  `E2E_EMAIL`, `E2E_PASSWORD` (defaults: the local demo admin). The Telegram edge is mocked inside the spec
  (worker flag, `send_lead_message`, `mark_lead_viewed`), so the run does not change the seed and can be repeated.
