# Round 1 (commit 656eca8) vs LEAD ref-1 Octolens + ref-2 HubSpot

Horizontal overflow: none at 390 / 768 / 1440 (ui-qa dom.overflow=false). Offenders listed are `.aiw-tab*` inside the
self-scrolling strip (intended, not page overflow).
ui-qa flags: A4 14 controls <24px (1440/768), 32 primary <44px + 15 inputs <16px at 390, C2 focus covered by sticky UI
(sticky header/FAB, shell-level), 1 focus without ring.

## 3 worst gaps
1. Funnel ledger rows ~80px tall (hint line under every label + 12px padding): at 1440 only 3 of 9 steps sit above the
   fold, so the descending shape (the one bold place) is not readable at a glance. Octolens reads as one calm column.
   Fix (distill): hint shown only in an opened row, row padding 8px, rows ≈44px.
2. Headline wraps «за 7 / дней» (max-width 30ch) and the red «AI не ответил» banner is the heaviest block in the panel,
   competing with the headline. Fix (quieter/polish): headline up to 40ch with `text-wrap: pretty`; banners compact
   (10px padding, lighter tint, title+help inline), button stays right on ≥768 and left-aligned under text on mobile.
3. 390: project strip shows only the active tab (second project invisible, «Новый проект» eats half the row); queue
   draft head squeezes meta into 3 lines next to «Открыть переписку» at 1440. Fix (clarify): switcher wraps on <600
   (strip full width, button below as quiet link), draft head wraps with link under name in narrow columns.
