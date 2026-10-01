# Design scorecard — AI page (lead-core-v2 T4), panel round 2, head f7e75ee
Verdict: FIX (design-judge). Round limit reached (5 build rounds, /ui-task §6) → owner decision; NOT a PASS.

Reviewers (pass 2, round-4 captures; B3/B4 + slop items re-verified by the judge on round 5):
- design-critic PASS overall 7 (clarity 8 content 9 defects 7 craft 7 uniqueness 7); VS_LEAD Octolens: hierarchy better, object better, finish worse.
- product-reviewer PASS 8/10 · marketing-reviewer PASS · slop-detector CLEAN after r5 · ui-qa pass 2 FIX (B3, B4) → both fixed in r5 (states/input-heights.json; leads/chats report.json visibleRing true).
Reconciled: overall 7, defects 7, craft 7 — below the new-screen floor (craft ≥8, defects 10).

Open FIX list (ordered):
1. major — shell FAB «Спросить UniLab» covers the draft next to «Отправить» at 1440 (after/full/app_view_ai-1440x900.png x1233–1420 y828–880). Shell = out of T4 scope → owner/orchestrator decides: clear zone on view=ai, collapse FAB, or accept.
2. 390 project tabs clip «Карточки товаров п…» without scroll affordance.
3. 390: 28 primary buttons <44px inside funnel rows / queue actions.
4. «обход» jargon in full state («Обойти сейчас», «20 обходов за 7 дней»).
5. no-project 1440: empty left column under «Создать проект».
6. Process: re-score design-critic on r5 captures; capture dialogs at 768 + save-error state.

Out of scope, pre-existing (also in before/): persistent sidebar at 768 pushes Leads content off-screen; global `button[data-slot=button]{box-shadow:none}` kills rings on other Leads buttons.
NOT verified: axe (not installed, axe:null), WebKit, keyboard/screen-reader pass, loading skeleton + save-error at runtime, real API (mock harness).
