# Round 2 (r1 fixes: ledger density, headline/banners, switcher + draft head) vs LEAD ref-1 / ref-2

Horizontal overflow: none at 390 / 768 / 1440 (dom.overflow=false).
Result: ledger rows 80px -> ~53px, at 1440 all steps through «Стоп-слова» above the fold (was 3); headline one line +
amber «27 лидов»; error banner quieter; 390 shows the second project tab and «Новый проект» below; draft head no longer
squeezes meta. Best round so far: r2.
ui-qa: A4 14 controls <24px (768/1440; not identified per element, likely shell/size=sm icon buttons), 390: 32 primary
<44px and 15 inputs <16px (390 only: the card editor inputs likely keep md:text-sm via a cascade win over `.aiw input`; verify),
C2 focus covered by sticky header/FAB (shell).

## 3 worst gaps remaining (next round)
1. Mobile/768 banner: at 390 the alert wraps the text block under the icon and the button floats mid-width; at 768
   title wraps «3 / сообщения». Fix: alert as grid `18px minmax(0,1fr) auto`, on <768 button in column 2 under text.
2. «Лиды» row is below the fold at every width (the payoff of the ledger is only in the headline). Fix: distill —
   collapse zero rows (Без оценки / Ошибка AI when 0) into one muted line, or tighten neutral steps to 40px.
3. Queue detail: «Открыть переписку» (ghost) sits indented on its own line; the draft textarea is cut by the FAB at 1440.
   Fix: link-btn aligned to text start (negative inline margin = its padding), keep queue panel sticky top on ≥1100.
Also: A10/A4 mobile counts above, total-row count not right-aligned with step counts (share column empty).
