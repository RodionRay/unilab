# Refs: "Найти чаты с клиентами" dialog (captured 2026-09-30)

## 1. LEAD — Slack channel browser (dialog shape, row anatomy)
- Source: Slack help "Join a channel" https://slack.com/help/articles/205239967 (flow text; no images there);
  PNG via third-party guide https://frontdeskchat.com/books/slack/working-in-channel/browse-slack-channels-join/ (older Slack UI, pre-Directories redesign; still the canonical shape).
- PNG: `ref1-LEAD-slack-channel-browser.png`
- TAKE:
  - Header: short title ("Channel browser", 2 words) + one secondary action top-right; no subtitle paragraph.
  - Full-width search directly under title; then a meta row: total count left ("75 channels"), Sort + Filter right as quiet text buttons.
  - Row = 2 lines, ~64-72px: line 1 name (semibold); line 2 muted "127 members · description…" (count FIRST, then 1-line truncated description). No avatars, no borders between cells, just hairline dividers.
  - One action per row (Join), revealed on hover/focus, always visible on touch; clicking row = preview.
  - Sort options: most members / A-Z / recent activity (from help/guides text).
- DO NOT take: light theme, low-contrast hairlines, hover-only action on mobile, "Create channel" CTA (not our job).

## 2. TGStat catalog (market/niche switch, number formatting)
- Source: https://tgstat.com/marketing (public; tgstat.ru blocked by Cloudflare challenge for headless).
- PNG: `ref2-tgstat-catalog-1440.png`, `ref2-tgstat-catalog-390.png`
- TAKE:
  - Scope selector as a small dropdown ("Global") = our market picker; category = page = our niche.
  - Two segmented controls: type ("All channels | All groups") left, sort ("By subscribers | By citation") right; stack on mobile (390).
  - Counts: thin-space grouping, number bold + unit muted: "**2 789 337** subscribers" -> ru: "2 789 337 участников" (Intl.NumberFormat('ru-RU')). Freshness "3 hours" right-aligned muted.
  - Description clamped to 2 lines.
- DO NOT take: 3-column card grid (too sparse for 275 items in a dialog), big avatars, ad cards, 2-level H1/H2 hero, light theme.

## 3. Linear (dark list, filter chips, multi-select + bulk bar)
- Source: https://linear.app/docs/filters , https://linear.app/docs/select-issues , bulk toolbar: https://linear.app/changelog/2019-06-27-backlog-and-active-issues
- PNG: `ref3-linear-filter-chips.png`, `ref3-linear-bulk-selection.png`
- TAKE:
  - Dark tokens: near-black surface, rows ~44px, selected rows = accent-tinted background + filled checkbox (checkbox shown on hover/when any selected).
  - Applied filters as removable chips in one bar above list ("Labels include Feature ×"); filter button at the end.
  - Group header with count ("In Review 12", "2 / 11") -> our niche header "Маркетинг · 12".
  - After selection a bulk toolbar appears at the BOTTOM (docs text; not visible in PNG): "N selected" + common actions + clear.
- DO NOT take: AND/OR advanced filters, AI filters, keyboard-only discoverability, dense ID column.

## LEAD decision
Confirmed Slack as LEAD: same job (browse many public rooms, see size, join one), dialog-sized, count-first meta line.
TGStat overrides Slack for numbers/segmented scope; Linear overrides both for dark visuals + bulk selection.
Rejected: Discord discovery (hero cards, marketing), Notion filter (too generic), Raycast/GitHub Marketplace (cards/install flow), Telegram global search (no counts/filters).

## Composite for our dialog
- Header: "Найти чаты с клиентами" + account picker right. Row 2: search. Row 3: market dropdown + niche chips/segmented; right: "275 чатов" count.
- Row: name / "12 480 участников · описание" / right: "Вступить" (secondary). Checkbox left for bulk.
- Mode "Мои группы": same row, actions "Скан лидов" (primary-ghost) + "Вступить"; do not show 2 filled buttons per row.
- Footer (sticky): left "Выбрано 12 из 275" + "Снять"; right "Импортировать все в workspace" (secondary) + "Вступить в 12" (primary).
- Mobile: dialog -> full-screen sheet, filters collapse to one "Фильтры (2)" button, bulk bar sticky bottom, row action always visible.

## Patterns for mass/destructive-ish action confirmation
- Name count + target in title AND button: "Вступить в 12 чатов аккаунтом @acc?" / button "Вступить в 12", never "Да/OK".
  NN/g: "must restate the user's request… with specific information" https://www.nngroup.com/articles/confirmation-dialog/ (2018, reviewed 2026-08).
- Don't confirm cheap reversible single actions (single Join) — confirm only bulk/import; "cry wolf" dilutes dialogs (same NN/g). Prefer undo/toast for single.
- Primer ConfirmationDialog: brief question title, verb labels, danger variant focuses Cancel by default https://primer.style/product/components/confirmation-dialog/
- Bulk toolbar appears only after selection, bottom anchored, shows count (Linear changelog above; docs/select-issues).
- Show consequences inline: rate-limit/time estimate ("~6 мин, Telegram ограничивает вступления") and which account; list first 3 names + "и ещё 9".
- Secondary (2026, non-primary): https://www.saasui.design/blog/saas-destructive-actions-confirmation-ux-patterns — bulk gets explicit count even when single uses undo.
