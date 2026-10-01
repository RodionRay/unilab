# Round 3 (banner grid, thread link in draft head, a11y floors) vs LEAD ref-1 / ref-2

Horizontal overflow: none at 390 / 768 / 1440.

## Gaps fixed
1. Banner: `.aiw-alert` is a grid `auto minmax(0,1fr) auto`; <768 the action spans the full width under the text
   (390: «Обойти сейчас» 44px full-width, no floating indent); ≥768 right-aligned, vertically centred.
2. «Открыть переписку»: link-style (muted, underline on hover, icon after) in the draft header right, flush with the
   panel edge; anatomy now who · chat · time | open thread → source quote → why → draft → actions.
3. FAB: `.aiw` padding-bottom 104px, focus scroll margins (top 96 / bottom 112) on every `.aiw` focusable.
4. 768: project switcher wraps below 1024px (both project names visible, «Новый проект» under them); the second
   tab was clipped under «Новый проект» in r2 (C2 covered).
5. Ledger: row padding 9→7px, bar 6→4px, min-height 44→40px: ~47px per step (was ~53).

## ui-qa r2 → r3 (`rounds/r3/full/report.json`)
| check | 390 | 768 | 1440 |
|---|---|---|---|
| A4 controls <24px | 2 → 1 | 14 → 13 | 14 → 13 |
| A4 buttons <44px (390 only) | 32 → 30 | – | – |
| A10 inputs <16px (390 only) | 15 → 0 | – | – |
| C2 no visible ring | 1 → 0 | 1 → 0 | 1 → 0 |
| C2 covered by sticky UI | 3 → 0 | 4 → 0 | 8 → 1 |

Inside `.aiw` A4 <24px = 0 at every width (probe: all 13 remaining are shell: 10 `.nav-drag` 22×32, «Настроить
аккаунты» 20px tall, «Выйти» 16×16, «О сервисе» 21px tall). A10 cause was a global
`input, textarea { font-size: .875rem !important }`; `.aiw` overrides it at <768 with `!important`.
The 30 buttons <44px at 390: the 4 named primaries (Отправить, Сохранить, Новый проект, Обойти сейчас) are 44px; the rest
are secondary (tabs 40, segment 28, chip remove 24, «Заново» / «Удалить пример» / «Добавить» 40, switch 24) and 2 shell.
1440 covered = 1 card-editor textarea reported `inView:false` right after focus; a direct probe after focus shows it
in view and on top (scrollY 1377, top 426): likely a measure-before-scroll timing artefact, not reproduced.

## Remaining (next round)
1. «Лиды» row still below the fold at 1440 (last visible: «Без оценки» at ~875px). Next: collapse zero rows
   (Без оценки 0) into one muted line.
2. Draft head at 1440: link takes width, meta wraps to 2 lines («35 / минут назад»). Next: meta on its own line under
   the name with `text-wrap: balance`, or icon-only link <1280 with aria-label.
3. 390: the second project tab is still cut («Карточки товаров п…») inside the scrolling strip; «Заново» right edge is
   8px inside the link-btn edge above it.
Best round: r3 (all r2 gaps 1 and 3 closed, a11y counts down, no regressions seen).
