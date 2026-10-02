# Rounds — groups filters + «Распределить по лимитам»

LEAD = `before/` (same screen, base commit 3147a47, same synthetic seed). Instance: isolated prod build on
127.0.0.1:5390, fresh local D1, self-registered QA user, synthetic groups/accounts only (no staff data).
States per round: top, default, filtered (`g_band=review&g_sort=score_desc&g_q=чат`), empty (`g_q=zzzqqq-nothing`),
confirm (tab «Ждут», sort ↓), result (1440, after confirm), noaccounts (accounts forced frozen in the GET response).

## Round 1 (`round-1/`, commit efa2bec)
Works: one filter bar under the chips, chip counts follow filters, filtered empty state names the filter and
offers the reset, confirm shows the per-account capacity preview, disabled button + hint without accounts,
no horizontal overflow at 390/768/1440. Result state not captured (local server too slow for a 15 s wait).
3 worst gaps vs LEAD:
1. Actionbar regression at 1440 — base fits in one row; the new button + count chip pushes the right group to a
   second row. Fix (distill): no count chip while nothing is selected (the count is in «Показано N из M» and in
   the confirm title); show «· N» only for a selection, like «Применить смесь · N».
2. Filter bar at 390/768 — label/control pairs spread by `space-between`, «Балл от» floats far from its input,
   the bar takes 3 ragged rows. Fix (polish): container query on `.groups-page`; under 640px of list width labels
   go above controls in a 2-column grid (search full width; band | min; sort | reset; count).
3. Filter bar at 1440 with an active filter — «Сбросить фильтры» drops to its own row. Fix (polish): search
   basis 240px / max 360px so band, min, sort, reset and the count fit in one row.
Also: confirm description is 4 lines — clarify/shorten to 2–3 lines.

## Round 2 (`round-2/`, uncommitted CSS/copy over efa2bec)
Fixed: 390/768 bar is a clean 2-column grid with labels above controls; dialog copy is 2 lines; the result
line shows («Назначено 11 (ёмкость 32)», success tone, dismissible).
3 worst gaps vs LEAD:
1. Actionbar at 1440 still wraps (right group drops to row 2); base was one row. Fix (distill): remove the
   no-information hint «Чекбоксы слева — массовые действия»; its place takes the information-bearing
   «Показано N из M».
2. Filter bar at 1440 with an active filter still pushes «Сбросить фильтры» to row 2 — the count costs ~100px.
   Fix: the count moves to the actionbar (gap 1), search basis 220px.
3. Result line has the same weight as the actionbar box — acceptable; keep (states are distinct by tone/icon).

## Round 3 (`round-3/`, build of commit 17dcf5e; resumed after a crash: instance rebuilt on 127.0.0.1:5390, same D1)
Fixed vs round 2: at 1440 the filter bar is one row with an active filter — «Сбросить фильтры» stays in the row
(`1440-filtered`); the count lives in the actionbar. Overflow 0px at 768/1440.
Measured (`notes.txt`): 1440 actionbar = 2 rows (left 268px + gap 10 + right 818px = 1096px > 1083px inner, 13px short);
390 filtered/empty/confirm overflow 4px (reset button 193px in a 173px grid cell).
3 worst gaps vs LEAD:
1. Actionbar at 1440 still two rows (LEAD: one). Fix (distill): «Выбрать все (31)» → «Выбрать все» — the number is
   already in «Показано N из M» right next to it; the selected state already uses the plain label.
2. Filter bar controls have three heights and two shapes (search 42px pill, selects 32px rounded-rect, score 42px
   pill, reset 36px) — at 390/768 «Балл от» sits 6px off «Релевантность». Fix (polish): one 36px height and the pill
   shape on every control in the bar; reset stretches inside its cell at narrow widths (kills the 4px overflow).
3. Copy: search placeholder truncated at 1440 («…ссылка или сс»); confirm description 3 lines at 1440, 4 at 390.
   Fix (clarify): placeholder «Название, ссылка или причина»; description «… — активные аккаунты в пределах их
   лимита на сегодня. Только назначение: вступление идёт как обычно.»

## Round 4 (`round-4/`, commit 413d6c3)
Fixed: 1440 actionbar is one row in default, filtered and confirm (LEAD parity); with an active filter the
filter bar is one row incl. «Сбросить фильтры» (`1440-filtered`); every filter control is a 36px pill; overflow
0px at all viewports and states (390 filtered/empty/confirm were 4px); confirm description 2 lines at 1440.
3 worst gaps vs LEAD:
1. `1440-noaccounts`: actionbar wraps — the disabled-reason hint «Нет активных аккаунтов для вступления» costs
   ~230px. Fix (distill): «Нет активных аккаунтов» — the button next to it already names the action.
2. 1440 with an active filter: search shrinks to ~225px and its placeholder clips («…ссылка или пр»). Fix (clarify
   + polish): placeholder «Название, ссылка, причина», bar gap 14→12px.
3. 390: «На подтверждение» in the half-width select runs under the chevron. Fix (polish): select padding-right
   36→30px (chevron box is 14–30px from the edge).

## Round 5 (`round-5/`, final; BEST)
Fixed: `1440-noaccounts` actionbar one row (hint «Нет активных аккаунтов»); 1440 placeholder no longer clips;
390 select text clears the chevron. All 20 captured states: overflow 0px; 1440 filter bar 1 row (36–40px) and
actionbar 1 row (62px) in top/default/filtered/empty/confirm/noaccounts/result — LEAD parity. Result line
(`1440-result`) «Назначено 11 (ёмкость 35)», success tone, dismissible; rows show the assigned accounts.
Remaining gaps (not fixed, round budget spent):
1. `1440-filtered-sel`: with a selection the actionbar takes 3 rows (selection adds «Не вступать», «Вступить»
   and «· N» counters). LEAD has no selected-state capture, so parity is unknown; candidate fix: overflow menu
   for the per-row bulk actions.
2. 390/768 row layout (title wraps word-per-line under «Одобрить») is pre-existing in LEAD, out of scope.
3. 390 actionbar is 4 rows (LEAD 4 rows) and the filter bar adds ~172px above the list on a phone; a collapsible
   «Фильтры» sheet would be the next step (ui-engineering-qa §A.11), not done in this small edit.
Best round = 5: only round with every captured state at LEAD parity on the 1440 one-row floor and 0px overflow.

## Round 6 (`round-6/`, commits 3fd135e + 888ca7f; review fix list L1–L8, U1–U11)
Seeded in the isolated D1 only (synthetic): Анна 18/20 joins today, Борис invite limit 3, Вера 3 of warm-up 5
→ capacity 7; one target on a farm account (kept), one on the frozen Глеб (replaced). Zero-capacity state:
every farm account has capacity 1 and one open assignment outside the target (`g_q=Казань`).
States: top, default, filtered, filters-open (390/768), empty, confirm (overflow: Назначим 7 / Не назначено 4 /
Ёмкость 7, «Сменим аккаунт: 1», «оставим: 1», «Пропущено 20»), confirm-zero (0/1/0, action disabled), result
(1440, warning «Назначено 7, не назначено 4 — … (ёмкость 7) · пропущено 20 — не для вступления»), noaccounts
(disabled button at opacity .5 + link «Нет активных аккаунтов»), focus-ring, focus-return (activeElement =
«Распределить по лимитам» after Enter → Esc at 390/768/1440), filtered-sel. Overflow 0px everywhere; 1440
actionbar 1 row in every state without a selection (filterbar «rows 2» in notes.txt = the hidden «Фильтры»
toggle counted at y=0, bar height 36–40px = one row).
Fixed vs round 5: 390 filter bar 172px → one row (search + «Фильтры»), first list row higher by ~130px;
«Воркер офлайн» shares the groups action row (no lone row); chip counts without opacity (≈5.9:1);
`.groups-page` 80px bottom room for the chat bubble; dialog numbers on one baseline at 390.
Remaining gaps:
1. 390/768 search placeholder clips next to «Фильтры» («Название, ссылка, пр»).
2. `1440-filtered-sel`: 3-row actionbar with a selection (out of scope: «Ещё ▾» follow-up).
3. 390/768 row layout overlap — pre-existing in LEAD, out of scope.
Best round = 6: every reviewed blocker (contrast, focus return, focus ring) and the 390 regression closed.
