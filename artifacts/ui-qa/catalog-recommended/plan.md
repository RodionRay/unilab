# Plan — «Найти чаты с клиентами»: only recommended chats + joined separated (REDESIGN, NEW/VALUE)

Owner verdict (verbatim, 2026-10-01): «Пересобрать фронт страницы, так как сейчас не понятно в какие вступил, каша по
группам большая, и нужно сделать так чтоб показывать только рекомендованные группы для вступления».
Owner decision 2026-09-30: join ONLY owner-queued groups; relevance band `auto` is labelled «Рекомендуем».
Before: `before/owner-stand-1440.png` (stand). Route `/app?view=groups` → «Поиск по темам» → Dialog `catalogOpen`
(`app/app/page.tsx`), CSS `app/globals.css` `.catalog-*`. Refs reused from the 2026-09-30 round: `refs/spec.md`
(LEAD = Slack channel browser; TGStat for counts; Linear for dark rows + bulk bar).

## Subject, user, job
Subject: public Telegram chats where the seller's buyers talk. User: owner of a lead-gen workspace, dark admin, desktop
first. ONE job: see which chats we advise joining for THIS project, and join them (owner intent = the queue). Second job:
see where we already are and collect leads there. Real object = the chat row (name, @handle, audience, why it fits).

## Diagnosis → decision
| # | Mess (before) | Decision |
|---|---|---|
| 1 | Market rail with 6+ overlapping categories (В базе 293, Все чаты 298, Блоги 255, Маркетплейсы 54, SaaS 116, Услуги 235) | Rail removed. No market/niche browsing in the dialog. The list is computed: recommended for the project |
| 2 | Joined and not-joined mixed in one list, «вступили» is a small badge | Two tabs (segmented, 2 options): «Рекомендуем · N» (default) and «Вступили · M». A chat is in exactly one tab |
| 3 | Full catalog (275/298) dumped | Recommended = workspace groups whose gate is `auto`/`approved` (stand: `joinGateFor`; dev: niche-match fallback) + project-niche catalog chats not yet in the workspace (stand: `catalogForProject`; dev: `searchGroupCatalog` onlyMatched with project niches). Review/skip/skipped/dead hidden; one quiet line says how many were hidden and where to see them («Группы и каналы» filters) |
| 4 | 4 footer actions (Собрать лиды / Дозалить по нишам / Все чаты каталога / Своя группа) | Per tab ≤2 footer actions. Рекомендуем: «С аккаунта [Pick]» left; right «+ Своя группа» (ghost) + «Вступить в N» (primary, only with selection → confirm). Вступили: right «Собрать лиды со всех · M» (primary, `rescan_groups`). «Дозалить по нишам» dropped: niche catalog chats already appear as recommended rows; joining one saves+queues it |
| 5 | Paragraph header about «В базе/Все чаты/Залить» | Title + one line: «Подобрали N чатов под ваш проект. Вступаем только в те, что вы отметите.» (N = same constant as the tab count) |
| 6 | 4-line cards, t.me badge, raw URL, «workspace»/«tgstat-blogs» source text | 2-line rows ~56px: line 1 name (semibold, truncate) ; line 2 muted `@handle · 12 480 подписчиков · why` (why = relevance reasons or niche labels, 1-line clamp). Right: one action |
| 7 | Join state unclear | Row state in words, right column: «Вступить» button (not queued) · «В очереди» / «Вступаем…» (warning text, no button) · in Вступили: «Заявка подана» (pending) or leads + last scan («12 лидов · скан 14:05») + «Скан лидов» ghost button |

«Показать все» decision: NOT added. The owner asked for only recommended; review/skip groups stay reachable in the page's
own filters (stand: «На подтверждение», «Не вступать») and the full catalog via «+ Своя группа» / mass import elsewhere.
A collapsed «все чаты» would re-open the same mess one click away and dilute the default; the hidden-count line keeps it honest.

## Token roles (existing, no new colours)
`--spike-bg` / surface (dialog), `--spike-border` (dividers), `--spike-text`, `--spike-muted` (meta line),
`--spike-primary` (amber — active tab + primary button + selected row tint only), success token (`.badge.success`
text colour) for «Вступили» count, warning token for «В очереди». Accent budget per viewport ≤4.

## Type
Title = DialogTitle existing (20/600). Row name 15/600. Meta 13/400 muted, tabular-nums. Tab label 14/500 with count 14/400.
Footer button text 14/600.

## Wireframe 1440 (dialog max-w-3xl, ~880px)
```
┌ Найти чаты с клиентами                                              × ┐
│ Подобрали 24 чата под ваш проект. Вступаем только в те, что отметите. │
│ [ Рекомендуем 24 | Вступили 6 ]                     [🔍 Найти в списке ] │
├───────────────────────────────────────────────────────────────────────┤
│ ☐ Выбрать все 24                                                       │
│ ☐ Селлеры WB                                            [ Вступить ]   │
│   @wb_sellers · 48 210 подписчиков · маркетплейсы, селлеры             │
│ ☐ Ozon продавцы                                          В очереди     │
│   @ozon_pro · 12 400 подписчиков · маркетплейсы                        │
│ …                                                                      │
│ Скрыли 41 чат не по теме — они в «Группы и каналы» → «Не вступать».    │
├───────────────────────────────────────────────────────────────────────┤
│ С аккаунта [Тестовый аккаунт 1 ▾]          + Своя группа  [Вступить в 3]│
└───────────────────────────────────────────────────────────────────────┘
```
Вступили tab: same row grid, no checkboxes; right = «12 лидов · скан 14:05» muted + «Скан лидов» ghost.
Footer: «Собрать лиды со всех · 6» primary.

## Wireframe 390 (full-screen sheet)
```
Найти чаты с клиентами            ×
Подобрали 24 чата под ваш проект…
[Рекомендуем 24][Вступили 6]
[🔍 Найти в списке          ]
☐ Селлеры WB          [Вступить]
  @wb_sellers · 48 210 подп…
…
───────────────────────────────
С аккаунта [Тест… ▾]
[+ Своя группа] [Вступить в 3 ]
```

## The ONE bold place
The tab switch «Рекомендуем 24 | Вступили 6»: large segmented control (h-10, counts bold), amber active state —
it answers the owner's two questions («куда вступать / где я уже») before anything else.

## Principles
1. One chat = one place (exactly one tab; dedupe by Telegram entity).
2. State in words, not badges (Вступить / В очереди / Заявка подана / N лидов).
3. Nothing joins without the owner's click (bulk always confirms with count + account).

## Generic test
"Would a similar prompt for another product land here?" — a generic answer would be card grid + filters sidebar.
Changed: rows carry the domain's own artefacts (@handle, подписчики, reason from relevance scoring), the empty state
points to the project description (the source of recommendations), and the hidden-count line names the real filter
in our app. Tab counts come from the same view object as the list.

## States
loading (catalog compute <1s → none; account list loading → Pick placeholder), first-use empty (no project niches:
«Опишите продукт в настройках AI — подберём чаты» + «Открыть настройки AI» + «+ Своя группа»), all-joined empty
(«Во все рекомендованные уже вступили» → switch to Вступили), Вступили empty («Пока ни в один чат не вступили»),
search no-results (name query + «Сбросить»), disabled (no workable account → Вступить disabled with reason
«Нет рабочего аккаунта», worker offline → «Запустите воркер»), long names (truncate + title attr), error (toast from api).

## Components (registry absent → grep)
Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription `components/ui/dialog.tsx`; Button `components/ui/button.tsx`;
Checkbox `components/ui/checkbox.tsx`; Input `components/ui/input.tsx`; AlertDialog `components/ui/alert-dialog.tsx`
(bulk confirm); Empty* `components/ui/empty.tsx`; `Pick` (page-local select in app/app/page.tsx); Tabs-like segmented =
existing `.catalog-tabs` CSS restyled. No new component.

## Data/logic (pure, tested): `lib/catalog-recommend.ts`
`buildRecommendedView({groups, catalog, gateOf?, recommendedKeys?, query?})` → `{recommended, joined, hiddenCount}`;
ported count/plural/row-meta/bulk-confirm helpers from `catalog-dialog-cleanup` (`lib/catalog-view.ts`).
Gate is injected: dev passes `nicheFallbackGate` (no relevance data on dev); stand passes `joinGateFor`.
