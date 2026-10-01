# UI QA report — http://127.0.0.1:8011 — 2026-10-01T06:28:14.061Z
Failures: 11

## /app?view=ai
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/rounds/r2/full/app_view_ai-390x844.png
  - A4 2 standalone controls < 24px
  - A4 32 primary buttons < 44px on mobile
  - A10 15 inputs < 16px on mobile (iOS zoom)
  - C2 1 focused elements without visible ring
  - C2 3 focused elements covered by sticky UI
  - vitals: LCP 1932 ms · CLS 0 · INP 24 ms (field)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/rounds/r2/full/app_view_ai-768x1024.png
  - A4 14 standalone controls < 24px
  - C2 1 focused elements without visible ring
  - C2 4 focused elements covered by sticky UI
  - vitals: LCP 1888 ms · CLS 0 · INP 24 ms (field)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/rounds/r2/full/app_view_ai-1440x900.png
  - A4 14 standalone controls < 24px
  - C2 1 focused elements without visible ring
  - C2 8 focused elements covered by sticky UI
  - vitals: LCP 1908 ms · CLS 0.03 · INP 32 ms (field)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.