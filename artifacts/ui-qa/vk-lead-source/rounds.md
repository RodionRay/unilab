# Rounds — VK lead source UI (T4, REQ-11, REQ-12)

Mode: SMALL EDIT of existing screens. LEAD = `before/` (same seed, same stand) — floor: no regression, Telegram looks unchanged.
Stand: production build served by wrangler on :5241 (+ worker :8841), seed `tools/seed.mjs` (fake data, no tokens),
round = `tools/round.sh <dir>` (full VK seed → all states; `--empty-vk` seed → `no-vk/` Telegram-only states).

## build-1
1. Accounts 1440: VK list grid wider than the panel (`minmax(170px)+minmax(150px)+…`) — «Действие» header clipped,
   «Нет прокси» reason cut. Fix (polish): fractional columns, 92px usage, 40px actions, actions header sr-only.
2. Full-page shots after a scrolled interaction (import) show the sticky sidebar/topbar painted mid-page — capture
   artefact, not UI. Fix (tooling): scroll to top before the shot.
3. Accounts 390: format guide (3 examples) pushes the VK list ~250px down; row proxy select squeezed next to usage
   («203.0.113.12:10»). Fix (distill): ≤900 hide the example list (keep the one-line note); proxy gets its own full row,
   usage moves up next to the status.
Checked equal to before: `no-vk/leads-all-*` vs `before/leads-all-*` (no badge, no platform filter, «Все группы»);
lead-detail-tg identical. 390 widths 458/627 px on accounts/leads are pre-existing overflow (before/ same widths).

## build-2
Fixed: list fits at 1440 (no clipped column), mobile rows: status + usage on one line, proxy full width; capture clean.
Worst gaps left:
1. Import results 1440: every failed line repeats a salmon badge AND salmon reason text — five loud lines, the
   low-contrast `.badge.danger` (#c2410c on pink) is the only readable cue. Fix (quieter): reason text muted,
   only the badge carries the tone; added lines keep normal text.
2. Row proxy select: value centred between the icon and the chevron, reads like a button label, not a value.
   Fix (polish): left-aligned value next to the icon.
3. Section head at 390: «Активных 2 из 5» wraps under the lede — acceptable (one line, reads as a summary); kept.

## build-3
Fixed: failed import lines now quiet (badge carries the tone, reason muted); proxy value left-aligned.
Worst gaps left (first-use / no VK data, `no-vk/`):
1. Accounts without VK accounts still show the bulk-delete bar («Отметьте аккаунты…») and «Активных 0 из 0» —
   two elements that carry no information. Fix (distill): render both only when accounts exist.
2. Groups without VK accounts show the «vk.com/имя_сообщества» input + disabled «Сообщество» next to the empty
   state that already says «need an account first». Fix (distill): hide the add form until an account exists.
3. Sonner info toast (white, existing app style) lands over the VK section head after an import — existing toast
   system, transient; not changed.

## build-4 — BEST
Fixed: first-use states carry only the import form + one empty sentence + one action (no bulk bar, no 0-of-0 count,
no add-community form before an account exists). Telegram-only workspace (`no-vk/leads-all-*`) matches `before/`.
Remaining (honest, not fixed — pre-existing, outside T4): 390/768 horizontal overflow of the Leads tab strip and the
Telegram accounts table (before/ has the same widths: leads 627/914, accounts 458/1039); white Sonner info toast.
Why best: last round with no new regressions; every state of REQ-11/12 present (leads all/VK/Telegram, lead detail
VK / VK with unsafe url / Telegram, accounts + import result, groups with error/never-scanned/long-title sources,
first-use empty states) at 390/768/1440.
