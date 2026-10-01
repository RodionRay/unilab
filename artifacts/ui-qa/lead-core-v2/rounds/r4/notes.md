# Round 4 — checks (build of d5a8585 + r4 fix: .aiw-draft minmax track, tighter draft/queue rhythm, «Заново» as link button)
Paths relative to `artifacts/ui-qa/lead-core-v2/`. Pre-fix reports: `rounds/r4/prefix-*-report.md`.

- (a) PASS — full 1440x900: «Отправить» 848–888px, fully above the fold, not under «Спросить UniLab» (x 982–1118 vs 1233–1420); headline «Из 797 сообщений за 7 дней AI нашёл 27 лидов» has no amber word (27 лидов = white underlined link). Pre-fix FAIL: button 878–918, cut by the fold. Evidence `after/full/app_view_ai-1440x900.png`.
- (b) PASS — ai-key-missing 1440: headline «Из 797 сообщений 91 ещё не проверено — AI не подключён», button «Открыть настройки»; owner sees «Для владельца: ключ можно задать и на сервере, переменной окружения AI_API_KEY.» Evidence `after/ai-key-missing/app_view_ai-1440x900.png`.
- (c) PASS — error 1440: alert «Не получилось загрузить проекты» + «Повторить», page frame (tab + two panel skeletons) below; empty area ~100px of 900 (<35%). Evidence `after/error/app_view_ai-1440x900.png`.
- (d) PASS — savebar clean = static row at card bottom («Все изменения сохранены», Отменить/Сохранить), not sticky, card heading «Карточка проекта» uncovered. Evidence `after/states/funnel-stopwords-open-390.png`.
- (e) PASS — 390 «Сайт» input full card width, «Пересобрать по сайту» full-width button below. Evidence `after/states/funnel-stopwords-open-390.png` (y≈2600–2750).
- (f1) FAIL — leads 1440: header labels ТЕМП./СТАТУС/ИСТОЧНИК sit at x 930–1135 over the message text; temperature/status badges are next to the name (x 480–620) and source is in the meta line — header not aligned with row content. Evidence `after/leads/app_view_leads-1440x900.png`. Out of r4 fix scope (leads list component).
- (f2) FAIL — leads 768: «Все группы» select cut at right edge (“Все группь”), page overflows (report.json 768 overflow=true, offenders main/header.topbar). Evidence `after/leads/app_view_leads-768x1024.png`. Same in r3 — not a regression; out of scope.
- (f3) PASS — no «npm run dev» text in leads/chats/AI shots (string exists only in `app/api/workspace/route.ts` worker-down errors, not rendered in these scenarios).
- (f4) PASS — chats 1440 shows «2 диалога». Evidence `after/chats/app_view_chats-1440x900.png`.
- (g) PASS — staff-redacted report.json failedReq=[] and consoleErrors=[] at 390/768/1440; proxy.log has no `-> 403` (3× funnel 200). Evidence `after/staff-redacted/report.json`, `after/staff-redacted/proxy.log`.
- (h) FAIL (partial) — overflow=false in all AI scenarios after fix (pre-fix: full + ai-key-missing 390 overflow=true, offender header.aiw-draft-head — fixed); leads 768 overflow=true (r3 too). r3 leads 390 overflow=true → now false.
  Counts r4 vs r3-after: A4 full 55/57 · ai-key-missing 54/57 · no-groups 52/55 · no-scans 52/55 · error 29/30 · no-project 29/29 · staff-redacted 34/34 · leads 59/59 · chats 40/40. C2 0 on all AI scenarios (r3: full 1, ai-key-missing 1, error 3, no-groups 2, no-scans 2, staff-redacted 4); leads 48/48, chats 12/12. A10: leads 1/1, chats 1/1, AI 0.
- (i) PASS — leave-dialog 390/1440: alertdialog «Карточка проекта не сохранена» with «Остаться» / «Перейти без сохранения»; project-menu-default 1440: «Удалить проект» disabled with reason «Основной проект нельзя удалить — в него попадают чаты без проекта». Evidence `after/states/leave-dialog-{390,1440}.png`, `after/states/project-menu-default-1440.png`.

States recaptured after the fix (390 shots now 390px wide; pre-fix 429px from the draft overflow).
