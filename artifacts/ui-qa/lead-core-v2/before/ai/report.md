# UI QA report — http://127.0.0.1:8011 — 2026-10-01T03:57:56.214Z
Failures: 10

## /app?view=ai
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/ai/app_view_ai-390x844.png
  - A4 1 standalone controls < 24px
  - A4 10 primary buttons < 44px on mobile
  - A10 1 inputs < 16px on mobile (iOS zoom)
  - C2 7 focused elements without visible ring
  - vitals: LCP 1480 ms · CLS 0.003 · INP 24 ms (field)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/ai/app_view_ai-768x1024.png
  - A4 13 standalone controls < 24px
  - C2 7 focused elements without visible ring
  - E7 LCP 3584 ms > 2500
  - vitals: LCP 3584 ms · CLS 0 · INP 32 ms (field)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/before/ai/app_view_ai-1440x900.png
  - A4 13 standalone controls < 24px
  - C2 7 focused elements without visible ring
  - E7 LCP 2812 ms > 2500
  - vitals: LCP 2812 ms · CLS 0 · INP 40 ms (field)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.