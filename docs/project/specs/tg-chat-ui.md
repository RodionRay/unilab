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
- REQ-1 Layout: WHEN view = «Переписки» and the chats container is ≥700px wide THE page SHALL show a dialog list
  (left, 340–380px) and the open chat (right) side by side, without a modal; narrower containers (768 with the app
  sidebar open, phones) show one column with list → chat navigation (amended 2026-10-02, DECISIONS.md). The Dialog
  stays for «Лиды».
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
- REQ-9 Themes: chat surface has dark (default, matches the app) and light palettes, scoped to «Переписки»
  (toggle «Светлая тема переписок»), persisted in localStorage `unilab.chatTheme`.
- REQ-10 Mobile 390px: list only → tap opens the chat full-screen with a back button; back returns to the list.
- REQ-11 States: loading, empty list («Нет диалогов»), no chat selected, empty thread, long names/text wrap,
  disabled send for viewer role.
- REQ-12 Tests: unit tests for the pure view model (`lib/chat-view.ts`); e2e journey (Playwright) open → read →
  type → Enter sends → bubble with status; mobile back navigation.

## Out of scope
Real read receipts, media, avatars from Telegram, per-message reply-to (not stored); a global light theme.

## Status (2026-10-02, after panel round 7)
Send flow: async send/draft results update only the chat they belong to (`app/app/page.tsx::openLeadIdRef`); the
composer empties when a send starts and gets the text back only on failure; a retry of a failed send replaces the
failed entry server-side (`lib/lead-conversation.ts::failedAttemptIndex`, `applySendOutcome` targets the newest entry
with the key); a failed bubble offers «Повторить» only while no later copy is delivered or in flight
(`ThreadMessage.retryable`). States: first run (no chats) with one next step, records load error with «Повторить»,
help FAB hidden while a chat is open, destructive «Удалить» in the delete confirm.

## Status (2026-10-02, after panel round 1)
Panel fixes applied: dedicated in-flight state (pending bubble reconciled by stored-copy count, cleared when the send
settles), no resend of an already-sent draft on open, draft-overwrite confirm, «Повторить»/«Копировать» on failed
bubbles with Telegram codes mapped to Russian (`describeSendError`), Telegram-offline and viewer composer states (viewer
skips `mark_lead_viewed`), delete/edit keep the chat, pinned opened row only while search+folder are unchanged,
memoised rows; a11y: focus rings, WAI-ARIA tablist (no dangling `aria-controls`), contrast ≥4.5:1 measured on render
(`artifacts/ui-qa/tg-chat-ui/contrast.mjs`), inert chrome + focus on open/back + Esc on phones, 16px search on phones,
one h1; optional `renderRowBadge(lead)` slot in list rows next to the name.

## Status (2026-10-02, first build)
REQ-1..REQ-12 implemented on `task/tg-chat-ui-2026-10-01`. Evidence: `tests/chat-view.test.ts` (view model),
`e2e/chats.spec.ts` (journey), screenshot rounds in `artifacts/ui-qa/tg-chat-ui/round-*` (not committed).
Known limits: the source post has no stored timestamp (lead creation time is used; hidden when it is later than the
first reply); «прочитано» (✓✓) is inferred from a later client message; incoming messages that arrive while a chat is
open re-mark it unread until it is reopened (no auto mark-viewed on poll).

## Component map
- View model (pure): `lib/chat-view.ts` — `buildThread` (date separators, 5-minute grouping, ticks, reply quote,
  unread divider, optimistic pending), `chatListItem` (preview prefixes, time label, unread count, failed flag),
  `unreadCountOf`, `unsentDraft`, `listTimeLabel`, `dateSeparatorLabel`, `initials`, `avatarTone`, `isSendShortcut`.
- Panel rules (pure, `lib/chat-view.ts`): `makeOutbox` / `pendingFor` (optimistic bubble), `openedFrom` /
  `listWithOpened` / `unreadOnOpen` (opened-row pinning, unread captured at click), `defaultMode`, `describeSendError`.
- Shell: `components/product/chats/chats-panel.tsx::ChatsPanel` — two panes, narrow container (<700px) = one column
  with back (`use-chat-layout.ts::useNarrowPanel`, `useFullScreenChat` makes the covered chrome `inert` on phones);
  `onSend`/`onRetry` return promises, the panel owns the in-flight state; draft-overwrite confirm (AlertDialog).
- `chat-list.tsx::ChatList` (search, folder tabs «Новые/Просмотренные», rows, skeleton, empty states),
  `chat-header.tsx::ChatHeader` (badges slot `[data-slot=chat-header-badges]`, theme toggle, open in Telegram,
  ⋮ Правки / Копировать / Удалить), `chat-thread.tsx::ChatThreadView` (scroll to divider or bottom, keep bottom on new
  messages, «вниз» button), `chat-composer.tsx::ChatComposer` (Enter/Shift+Enter, reply bar for «Ответ в группе»,
  AI draft), `chat-theme.ts::useChatTheme` (localStorage `unilab.chatTheme`), `chat-ticks.tsx::ChatTick`,
  `chat-avatar.tsx::ChatAvatar`.
- Wiring: `app/app/page.tsx` — `<ChatsPanel>` for view «Переписки» (active chat = `detail` looked up in `records`,
  callbacks = `openLead` / `sendLeadReply(force,{text,mode,keepComposer})` / `draft` / `open('lead')` / `setDeleting`
  / `navigate('Аккаунты')`); the `<Dialog open={!!detail&&view!=='Переписки'}>` stays for «Лиды»; `navigate` clears
  `detail`. Read-only = `chatReadOnly` (staff role `viewer`; also skips `mark_lead_viewed`). Lookups memoised:
  `chatGroupRefs`, `chatAccountNames`, `chatCounts` (folder counts narrowed by the search).
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
  `E2E_EMAIL` (default the local demo admin email), `E2E_PASSWORD` (required, no default: the run fails fast without
  it, like the seed's `DEMO_PASSWORD`). Example: `E2E_PASSWORD=<local admin password> npm run test:e2e`. Journeys: send
  (Enter / Shift+Enter, unread divider), mobile back + focus + Esc, pending clock, failed + «Повторить» in place,
  Telegram offline, viewer read-only, switching chats during an in-flight send. The seed refuses non-local `DEMO_URL`. The Telegram edge is mocked inside the spec
  (worker flag, `send_lead_message`, `mark_lead_viewed`), so the run does not change the seed and can be repeated.
