# UI QA report — http://127.0.0.1:8011 — 2026-10-01T06:39:19.486Z
Failures: 12

## /app?view=ai
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/staff-redacted/app_view_ai-390x844.png
  - A4 1 standalone controls < 24px
  - A4 21 primary buttons < 44px on mobile
  - E8 console errors: 1
  - E8 failed requests: 1
  - vitals: LCP 1976 ms · CLS 0 · INP 32 ms (field)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/staff-redacted/app_view_ai-768x1024.png
  - A4 6 standalone controls < 24px
  - E8 console errors: 1
  - E8 failed requests: 1
  - vitals: LCP 1944 ms · CLS 0.043 · INP 32 ms (field)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/staff-redacted/app_view_ai-1440x900.png
  - A4 6 standalone controls < 24px
  - C2 4 focused elements covered by sticky UI
  - E8 console errors: 1
  - E8 failed requests: 1
  - E7 CLS 0.124 > 0.1
  - vitals: LCP 1988 ms · CLS 0.124 · INP 32 ms (field)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.