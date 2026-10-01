# Groups screen — filters + «Распределить по лимитам» (small edit, existing screen)

Subject: Telegram groups the account farm should join. User: owner of the farm. Job of this edit: narrow
292+ groups to the relevant ones and hand today's join capacity of active accounts to them in one action.
LEAD reference: `before/` screenshots of this same screen (small-edit mode: no regression is the floor).

## Palette roles (existing tokens only, app/globals.css)
- surface `--spike-paper`, page `--spike-bg`, lines `--spike-border`
- text `--spike-text`, meta `--spike-muted`
- accent `--spike-primary` (#ffa92c): active chip, the one primary action in the confirm, capacity bar fill
- state: `--spike-warning(-light)` result with overflow, `--spike-success(-light)` full result, `--spike-error(-light)` API error

## Type roles
- dialog title 18px semibold; preview numbers 24px semibold tabular; section labels 12px muted;
  controls 13–14px; chip 12px (existing); row meta 12px (existing)

## Wireframe
1440:
```
[Найти темы][Ссылка][Массово][Переобход][История][Вступить во все]
hint line
(Все 292)(Ждут 40)(На подтверждение 120)(Не вступать 90)(Вступили 30)(Заявки 2)(Ошибки 10)
[🔍 Название, @username, ссылка, причина ........][Релевантность ▾][Балл от [ 0 ]][Сортировка ▾] [Сбросить фильтры]   Показано 40 из 292
| Чекбоксы слева…  [Выбрать все (40)]        [Аккаунт][Назначить][Смешать][⚖ Распределить по лимитам · 40] |
[result line: Назначено 25, без аккаунта 15 — лимит на сегодня исчерпан (ёмкость 25)   ×]
list…
```
768: filter bar wraps to 2 lines: search full width, then selects + min + sort + reset; count under.
390: every control full width stacked 2 per row (selects), search full width; actionbar wraps; no h-scroll.

## The ONE bold place
The confirm dialog preview: three large numbers (Назначим / Без аккаунта / Ёмкость сегодня) + per-account
capacity bars (name · +n of left) — the owner sees the result before writing anything.

## Principles
1. Filters live next to the list they filter (search moves from the global toolbar into the groups bar — one input).
2. Numbers before words: counts on chips, «Показано N из M», preview numbers in the dialog.
3. Assignment only — copy says «назначим», never «вступим»; joining stays per row / farm.

## Generic test
"Would a similar prompt for another product land here?" — a plain filter row + confirm «Вы уверены?» would.
Revised: the confirm is a capacity preview with real per-account numbers from the same helper as the server;
the empty state names the active filters instead of a generic «Ничего не найдено».
