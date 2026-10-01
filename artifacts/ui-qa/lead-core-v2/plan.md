# Plan — AI page (view=ai) redesign · lead-core-v2 T4

## Subject, user, job
Subject: a Telegram lead finder that reads every message in a project's chats and lets an LLM judge decide.
User: a seller/agency owner (non-technical, Russian), checks the page 1–3×/day.
ONE job of the screen: "Is my project finding leads — and if not, where do the messages go?" then
"approve what the AI wants to say". Secondary: describe the project in plain words.
Order on the page follows that job: project switcher → funnel (diagnosis) → approval queue (action) →
project card (cause / tuning). The card is the longest part but the least frequent; it sits below.

## Tokens (existing, globals.css :root — no new colours)
- surface: `--spike-bg` page, `--spike-paper` panels (`.panel`), `--spike-border` hairlines inside panels only.
- text: `--spike-text`, `--spike-muted`.
- accent: `--spike-primary` (amber) — ONLY: active project tab, the «Лиды» funnel row bar, primary «Отправить».
  ≤5 uses per viewport.
- states: `--spike-warning`(+light) for skipped steps «Без оценки» and banners (no key/limit);
  `--spike-error`(+light) for «Ошибка AI»; `--spike-success` for saved state; neutral steps = muted bar.
- radius: `--spike-radius-card` panels, `--spike-radius-pill` chips/tabs. Shadow: none inside panels.

## Type (existing scale)
- h1 page title (existing header) · h2 = panel title (existing `.panel h2`) · row label 15px/500 ·
  count 15px tabular-nums 600 right-aligned · helper 13px muted · sample text 14px, clamp 3 lines.

## Components reused (paths)
- `components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `switch.tsx`, `slider.tsx` (minScore) or native
  range, `toggle-group.tsx` / `tabs.tsx` (24 ч / 7 дней, project switcher), `collapsible.tsx` (funnel row
  samples), `skeleton.tsx`, `empty.tsx`, `alert.tsx` (banners), `dialog.tsx`/`alert-dialog.tsx` (new project,
  delete with move), `dropdown-menu.tsx` (project actions), `sonner` toast (existing `toast`).
- CSS reused: `.panel`, `.panel-heading`, `.badge.*`, `.kw-editor` + `.kw` (stop-word chips), `.small-note`, `.muted`.
- New (components/product/ai/**, DECISIONS line in the T4 commit): `AiWorkspace` (container + data),
  `ProjectSwitcher`, `FunnelPanel` + `FunnelRow`, `ApprovalQueue` + `DraftItem`, `ProjectCardEditor` +
  `ExampleList`, `useAiProject` (active project via URL `project` / sessionStorage). Styles prefixed `.aiw-`.

## Wireframe 1440 (content column ≈ 1120 next to sidebar)
```
[h1 AI-ассистент]                                        (existing header)
[Фулфилмент для WB ▾ | Карточки товаров ]  [+ Новый проект]   ← pill tabs, overflow scroll on mobile
┌ Воронка за [24 ч|7 дней] ─────────────────────┐ ┌ На одобрении (3) ──────────┐
│ «Из 1 240 сообщений AI нашёл 9 лидов»   (bold)│ │ Марина К. · горячий · 86   │
│ banner: Нет ключа AI — 312 не оценены [Настр.]│ │ "Ищу фулфилмент под WB..." │
│ Собрано          1 240 ███████████████████    │ │ [textarea draft         ]  │
│  Старые            310 █████                  │ │ [Отправить] [Отклонить] ↗  │
│  Короткие          120 ██                     │ │ ─────                      │
│  Повторы            80 █                      │ │ next item…                 │
│  Стоп-слова         42 ▌    ▸ samples         │ └────────────────────────────┘
│  Без оценки          0                        │
│  Ошибка AI           0                        │
│  Не лид            679 ███████████            │
│ Лиды                 9 ▌ (amber)              │
│ Личные сообщения: 14 → 1 лид   ▸              │
└───────────────────────────────────────────────┘
┌ Карточка проекта «Фулфилмент для WB»   [Пересобрать по сайту] [⋯ удалить] ┐
│ Что продаём (textarea)          │ Кто лид (textarea)                       │
│ Кто не лид (textarea)           │ Тон и призыв (tone + cta)                │
│ Стоп-слова chips 12/50                                                     │
│ Примеры: Хорошие (3/10) list + add │ Плохие (2/10) list + add               │
│ Порог 50 [slider] · Черновики сами для горячих [switch]                    │
│                                         sticky footer: Сохранено ✓ / [Сохранить] │
└────────────────────────────────────────────────────────────────────────────┘
```
1440: funnel 7fr | queue 5fr; card full width, 2-col field grid. 768: single column (funnel, queue, card),
card fields 1 col. 390: single column, project tabs scroll horizontally inside their own strip (no page
scroll), funnel rows: label left / count right, bar under label, queue actions full-width buttons.

## The ONE bold place
The funnel: a real descending ledger of what happened to THIS project's messages, headline sentence with the
two real numbers («Из 1 240 сообщений за 7 дней AI нашёл 9 лидов»), bars proportional to «Собрано», the
«Лиды» row the only amber bar. Nothing else on the page competes (no stat tiles, no icon cards).

## States
loading (skeleton shaped like funnel rows + queue items) · no project (Empty: «Создайте первый проект» +
button) · no groups («В проекте нет групп» → «Добавить группы» navigates to Группы и каналы) · no scans
(«Ещё не было обхода» → «Запустить обход») · error (alert + «Повторить») · AI key missing / judge errors
(plain Russian banners above rows) · queue empty («Черновиков на одобрении нет») · dirty card (Сохранить
enabled, «Есть несохранённые изменения») · saved («Сохранено»).

## Principles
1. Diagnosis first: every number answers "where did my messages go", in words a seller uses.
2. Edit in place, save a patch of changed fields only; nothing is sent without a click.
3. Dense, calm, one accent: the existing dark panel language, no new card styles.

## Generic test
"Would a similar prompt for any other product land here?" — a generic AI-settings page would be a form with
a stat-tile strip. Changed: no stat tiles; the hero is the project's own funnel ledger with drop reasons and
real sample messages from Telegram chats; queue items show the chat message the draft answers; copy speaks
in the seller's terms (чаты, лиды, черновик), not system terms (judge, scan_day, verdict).
