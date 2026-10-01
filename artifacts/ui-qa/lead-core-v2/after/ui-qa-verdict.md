# UI QA verdict, pass 2 — /app?view=ai + Leads/Переписки changes (lead-core-v2, round 4, head 6b90fbb) — 2026-10-01

**Verdict: GAPS_FOUND (FIX).** Pass-1 blockers B1 and B2 are fixed. 2 new in-scope blockers (B3 = regression of the r4 M1 fix,
B4 = new feedback buttons fail C2), 9 minor. Shell findings listed separately.
NOT verified: axe (`axe: null` in every report.json), WebKit, reduced-motion / forced-colors, 320/1024/1920 widths, «Новый проект»
dialog, 24 ч state, loading skeleton, invalid card form, manual keyboard / screen-reader pass, leave-dialog at 768, project-menu at 768,
Esc / focus return of the leave dialog, chats project filter (no project select is rendered on Переписки in any capture).
Sources: 9 × `after/<scenario>/report.json` re-parsed (DOM, focus walk, console, failedReq, vitals); 27 viewport PNGs read at native
scale; 13 `after/states/*.png` read as 45 viewport-height crops (sidebar trimmed at 768/1440); `before/leads` 1440/768 for comparison.
Capture artefacts ignored: fixed topbar / FAB / sticky savebar drawn mid-page in full-page `states/*`; text inserted mid-word in
`draft-editing-*` and `card-dirty-*` (Playwright caret).
Checks per PNG (§F): hierarchy; edge/number-column alignment; clipping/overlap; spacing; wraps/orphans; same-role control size and
disabled state; dark contrast, no white islands; layout integrity; mobile (2D scroll, columns ≥150px, buttons grouped, FAB vs last row,
input ≥16px); states (empty CTA, error above the fold, dirty status, modal + backdrop); cross-screen consistency.

## Pass-1 findings re-checked
| id | status | evidence |
|---|---|---|
| B1 error «Повторить» no ring | FIXED | `after/error/report.json` focus walk: «Повторить» visibleRing true at 390/768/1440, 324×44 at 390 |
| B2 sticky savebar over card heading | FIXED | pristine savebar is a static row at card end: `states/funnel-stopwords-open-{390,768,1440}.png` (390 y≈5180, 1440 y≈2610); `no-groups`/`no-scans` 390/768/1440 viewports show no bar at rest; dirty bar sticky only when dirty (`states/card-dirty-*`) |
| M1 «Сайт» squeezed | 390 FIXED, 768 OPEN, regression B3 | 390 input full width + button under; 768 still «https://uniseller.io/fulfillme» clipped, ~194px (`states/card-dirty-768.png` y≈1220) |
| M2 textareas `covered` at 1440 | FIXED | `covered: []` in every AI scenario |
| M3 pristine status under FAB at 768 | FIXED at rest; order still flips | status left at 1440, right/below at 768/390 (`states/funnel-stopwords-open-768.png` y≈5370 vs `-1440.png` y≈2610) |
| M4 «→ 3 / лида» break | FIXED | «6 входящих / → 3 лида» wraps before the arrow, number+noun together (`states/card-dirty-390.png` y≈1230) |
| M5 390 tab clip «Карточки товаров п…» | OPEN | every 390 AI PNG y≈266; DOM offenders `button.aiw-tab` |
| M6 768 cramped 2-col | OPEN | slider row label column ~180px, 5-line help (`states/card-dirty-768.png` y≈2650); no-project 768 sample 4-line headline (`after/no-project/app_view_ai-768x1024.png` x 556-706) |
| M7 CLS / LCP / copy | PARTLY | staff-redacted 1440 CLS still 0.124 (>0.1, D); ai-key-missing LCP now 1264 ms (fixed); copy now «Для владельца: … AI_API_KEY» (acceptable) |
| r3 draft meta wrap 1440 | FIXED | single line «Селлеры Wildberries \| Чат · 35 мин назад» |
| L1 leads header gutter | MOSTLY FIXED | gutter gone; «ЛИД» x≈317 vs names x≈326 (9px), `after/leads/app_view_leads-1440x900.png` y≈463 |
| L2 leads 768 «Все группы» cut | OPEN (pre-existing overflow, worsened) | `after/leads/app_view_leads-768x1024.png` y≈343; report overflow=true |

## Blockers (in scope)
B3. **<480px: «Сайт» and both «Текст из чата» inputs collapse to ~26px tall** (name input 36px), 16px text touching the borders —
    `states/funnel-stopwords-open-390.png` y≈2690-2720 (2× zoom confirmed), same in `card-dirty-390`, `draft-editing-390`,
    `leave-dialog-390`, `project-menu-default-390` (example inputs y≈3790, 4070). Cause: `@media (max-width:479px)` sets
    `.aiw-site-row, .aiw-example-add { flex-direction: column }` (`app/globals.css:5977-5986`) while the children keep
    `flex: 1` (`:5633`, `:5716`) → flex-basis 0 on the vertical axis. Expected: `flex: none` (or `min-height: 44px`) on those inputs
    inside the <480 rule — same-role controls same size (§F.3), A4 touch height.
B4. **New feedback buttons «Хороший лид» / «Не лид» have no visible focus ring (C2)** — focus walk `visibleRing:false` at 390/768/1440
    in `after/leads/report.json` and `after/chats/report.json`. Rendered by `app/app/page.tsx:2072-2077` (and `:3857`) with the shared
    ghost `Button`; «Открыть» / «Добавить лид» fail the same way (pre-existing, also `before/leads`). Expected: visible ≥2px ring
    3:1 on these row actions (scope-local `:focus-visible` rule, or fix the shared ghost variant).

## Minor (in scope)
N1. ai-key-missing 768: banner keeps 2 columns, text column ~150px → 9-line body + 3-line footnote, right column mostly empty
    (`after/ai-key-missing/app_view_ai-768x1024.png` y 535-830). Expected: action under the text below ~560px container (as at 390).
N2. staff-redacted: headline «27 лидов» is a button «открыть раздел «Лиды»» but the staff sidebar has no «Лиды»
    (`after/staff-redacted/app_view_ai-1440x900.png` y≈408; `app/app/page.tsx:3004` passes `onOpenLeads` unconditionally).
    Expected: plain number when the user has no leads access.
N3. Leave dialog: the destructive «Перейти без сохранения» is the filled accent button, «Остаться» outline (B6 — no dangerous
    default emphasis) — `states/leave-dialog-1440.png` y≈2680, `-390.png` y≈2190. Expected: «Остаться» primary.
N4. Error state draws pulsing-style skeletons under the alert (`after/error/*`) — reads as «still loading». Optional: static outline.
N5. Leads/chats row actions ragged: «Открыть» / «Хороший лид» / «Не лид» centred at different x (1440 x 1252-1275; 390 x 61-85,
    not full width) — `after/chats/app_view_chats-390x844.png` y 700-800. Expected: left-aligned group or full-width on mobile.
N6. Leads 1440 header ТЕМП./СТАТУС/ИСТОЧНИК sits over message text, badges are next to the name (pre-existing, `before/leads` same).
N7. Vitals to re-measure: no-scans 768 INP 9024 ms (single outlier, others ≤40 ms); leads 390 CLS 0.5 (r3-after 0.086, before 0.373).
N8. 768/390 savebar order differs from 1440 (see M3). N9. «Лиды» row still below the fold at 1440 (known r3).

## Shell / pre-existing — out of scope
FAB «Спросить UniLab» stays above the AlertDialog backdrop (not dimmed, clickable) at 390 and 1440 (`states/leave-dialog-*`) and
covers content at rest (draft footer 1440 y≈880, funnel chevrons/percent at 390, savebar status at 768 when scrolled to card end);
persistent 270px sidebar at 768 (A12) pushes leads content off-screen (overflow `main`, `header.topbar`, bell + «О сервисе» gone);
A4: `.nav-drag` 22×32, «Выйти» 16×16, «О сервисе» 21px, «Настроить аккаунты» 20px, 28 primary <44 at 390 (mostly shell/funnel rows);
390 breadcrumb leading «›»; footer repeats «Тёплые заявки из Telegram»; leads/chats A10 search input <16px at 390; stickyPct 112-114 %
at 768/1440 = sidebar counted as sticky; staff sidebar card «Администратор / Сотрудник кабинета» (mock naming).

## Per-screenshot verdicts
| screenshot | verdict |
|---|---|
| full 1440 / 768 / 390 | OK in `.aiw` except M5 (390), N9; FAB overlap = shell |
| error 1440 / 768 / 390 | OK: alert above fold, ring present, 44px at 390; N4 |
| no-project 1440 / 390 | OK (first-run CTA + sample funnel) |
| no-project 768 | M6 |
| no-groups, no-scans 1440 / 768 / 390 | OK: empty states with CTA, no savebar at rest; M5 at 390 |
| ai-key-missing 1440 / 390 | OK |
| ai-key-missing 768 | N1 |
| staff-redacted 1440 / 768 / 390 | OK visually; N2; M7 CLS 1440 |
| leads 1440 | L1 residual 9px, N5, N6; B4 (focus walk) |
| leads 768 / 390 | L2 (pre-existing overflow); N5; B4 |
| chats 1440 / 768 / 390 | OK layout; «2 диалога» shown; N5; B4 |
| states/funnel-stopwords-open 1440 | OK: samples aligned, static savebar |
| states/funnel-stopwords-open 768 | M1 (768), M6, N8 |
| states/funnel-stopwords-open 390 | B3; rest OK |
| states/card-dirty 1440 | OK: ring on textarea, dirty status, rebuild disabled |
| states/card-dirty 768 | M1, M6 |
| states/card-dirty 390 | B3 |
| states/draft-editing 1440 / 768 | OK: ring on draft; at 1440 «Отправить» drops to y≈888 as the draft grows (acceptable) |
| states/draft-editing 390 | B3 |
| states/leave-dialog 1440 / 390 | N3; FAB above backdrop = shell; dialog centred, initial focus on «Остаться» |
| states/project-menu-default 1440 / 390 | OK: «Удалить проект» disabled with reason; B3 visible on 390 |
