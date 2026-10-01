# Round 5 (final) — fixes against after/ui-qa-verdict.md
Build: `harness/serve.sh --rebuild` (fresh dist), proxy per scenario, ui-qa → `after/<scenario>/`, `harness/states.mjs` → `after/states/`.
Gates: eslint `components/product/ai` 0 problems, `app/app/page.tsx` 28 errors (baseline, none new); tsc on ai + page 0; `vitest run tests/ui-*` 41/41.

| Item | Fix | Evidence |
|---|---|---|
| B3 inputs collapse <480 | `.aiw-site-row > input`, `.aiw-example-add > input`: `flex:none; min-height:44px` in the <480 rule; all card text inputs 44px <768 | `after/states/input-heights.json`: 390 name/site/example 324×44 (site button 324×44) |
| M1 «Сайт» row at 768 | `.aiw-site-field` is a size container; row stacks below 480px of its own width | input-heights.json: 768 column (input 415×36, button 415×40), 1440 row (303 + 213) |
| B4 feedback focus ring | unlayered `button[data-slot=button]{box-shadow:none}` kills Tailwind `ring-*`; className uses `focus-visible:outline-solid outline-2 outline-offset-2 outline-[var(--spike-primary)]` | `after/leads/report.json` + `after/chats/report.json`: «Хороший лид» / «Не лид» visibleRing true at 390/768/1440 (8 + 2 stops) |
| Key banner 768 | `.aiw-banners` container, <900px → icon+text row, action full row | `after/ai-key-missing/app_view_ai-768x1024.png` |
| Staff «27 лидов» link | page passes `onOpenLeads` only with `canSeeLeadText`; FunnelLedger also gates by `leadTextVisible` | `after/staff-redacted/app_view_ai-1440x900.png` (plain text) |
| Leave dialog | «Остаться» = default (primary, Radix initial focus on Cancel), «Перейти без сохранения» = outline, primary on the right | `after/states/leave-dialog-{390,1440}.png` |
| Savebar clean | Отменить/Сохранить rendered only when dirty or saving | input-heights.json `saveBtns: 0` on clean load; `after/states/card-dirty-*.png` show them |
| Queue meta | chat name own line (ellipsis), relative time own muted line; footer «Ответ уйдёт в чат «…»» / «в личку @…», no account name | `after/full/app_view_ai-1440x900.png` |
| Owner key note | «Если ключа нет в настройках, его задаёт администратор сервера.» | `after/ai-key-missing/app_view_ai-768x1024.png` |
| No-project sample | labels from live steps (`oldStepLabel(7)`, «Короткие (меньше 12 символов)»), sums to 540; preview has no border/background; grid `align-items:start` | `after/no-project/app_view_ai-1440x900.png` |
| No-scans copy | «Чаты ещё не проверялись» / «Проверить чаты сейчас» | `after/no-scans/*` |
| Harness typing | `press('ControlOrMeta+End')` before `pressSequentially` | `harness/states.mjs` |

Overflow: false on full, no-project, no-scans, ai-key-missing, staff-redacted at 390/768/1440.
Not fixed (out of the named scope): `leads` 768 horizontal overflow true; «Добавить лид», «Собрать лиды», «Открыть» (leads/chats) still no visible ring — same box-shadow cause.
