# UI QA report — http://127.0.0.1:8011 — 2026-10-01T03:58:11.554Z
Failures: 15

## /app?view=leads
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/leads/app_view_leads-390x844.png
  - A7 horizontal overflow: div.flex.flex-wrap, button.flex.items-center, svg, path, div.group/tabs.flex, div.group/tabs-list.inline-flex, button#radix-_R_71d1li_-trigger-working.relative.inline-flex, button#radix-_R_71d1li_-trigger-viewed.relative.inline-flex
  - A4 7 standalone controls < 24px
  - A4 39 primary buttons < 44px on mobile
  - A10 1 inputs < 16px on mobile (iOS zoom)
  - C2 21 focused elements without visible ring
  - E7 CLS 0.373 > 0.1
  - vitals: LCP 1076 ms · CLS 0.373 · INP 32 ms (field+cta)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/leads/app_view_leads-768x1024.png
  - A7 horizontal overflow: main.relative.flex, header.topbar, div.topbar-actions, button.notify-bell, svg, path, path, a.text-link.flex
  - A4 19 standalone controls < 24px
  - C2 21 focused elements without visible ring
  - C2 13 focused elements covered by sticky UI
  - E7 CLS 0.362 > 0.1
  - vitals: LCP 1068 ms · CLS 0.362 · INP 32 ms (field+cta)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/leads/app_view_leads-1440x900.png
  - A4 25 standalone controls < 24px
  - C2 21 focused elements without visible ring
  - C2 3 focused elements covered by sticky UI
  - E7 CLS 0.35 > 0.1
  - vitals: LCP 1244 ms · CLS 0.35 · INP 48 ms (field+cta)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.