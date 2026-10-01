# UI QA report — http://127.0.0.1:8011 — 2026-10-01T06:39:32.783Z
Failures: 13

## /app?view=leads
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/leads/app_view_leads-390x844.png
  - A7 horizontal overflow: div.flex.flex-wrap, button.flex.items-center, svg, path, button.flex.items-center, span, svg, path
  - A4 1 standalone controls < 24px
  - A4 27 primary buttons < 44px on mobile
  - A10 1 inputs < 16px on mobile (iOS zoom)
  - C2 14 focused elements without visible ring
  - vitals: LCP 888 ms · CLS 0.086 · INP 32 ms (field+cta)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/leads/app_view_leads-768x1024.png
  - A7 horizontal overflow: main.relative.flex, header.topbar, div.topbar-actions, button.notify-bell, svg, path, path, a.text-link.flex
  - A4 13 standalone controls < 24px
  - C2 14 focused elements without visible ring
  - C2 5 focused elements covered by sticky UI
  - vitals: LCP 856 ms · CLS 0.024 · INP 32 ms (field+cta)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/leads/app_view_leads-1440x900.png
  - A4 18 standalone controls < 24px
  - C2 14 focused elements without visible ring
  - C2 1 focused elements covered by sticky UI
  - E7 CLS 0.25 > 0.1
  - vitals: LCP 992 ms · CLS 0.25 · INP 40 ms (field+cta)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.