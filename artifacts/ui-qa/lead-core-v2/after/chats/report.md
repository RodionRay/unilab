# UI QA report — http://127.0.0.1:8011 — 2026-10-01T07:08:52.613Z
Failures: 9

## /app?view=chats
- 390x844: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/chats/app_view_chats-390x844.png
  - A4 1 standalone controls < 24px
  - A4 8 primary buttons < 44px on mobile
  - A10 1 inputs < 16px on mobile (iOS zoom)
  - C2 4 focused elements without visible ring
  - E7 CLS 0.141 > 0.1
  - vitals: LCP 220 ms · CLS 0.141 · INP 24 ms (field)
- 768x1024: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/chats/app_view_chats-768x1024.png
  - A4 13 standalone controls < 24px
  - C2 4 focused elements without visible ring
  - vitals: LCP 180 ms · CLS 0.011 · INP 32 ms (field)
- 1440x900: ISSUES — /Users/rodiontipcov/worktrees/wt-unilab-lead-core-v2-2026-10-01-ui/artifacts/ui-qa/lead-core-v2/after/chats/app_view_chats-1440x900.png
  - A4 18 standalone controls < 24px
  - C2 4 focused elements without visible ring
  - vitals: LCP 296 ms · CLS 0.008 · INP 24 ms (field)

Next: inspect every screenshot at native scale per §F (viewport-height crops), write per-screenshot verdicts.