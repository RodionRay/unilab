---
slug: groups-filters-bulk-assign
size: quick
status: approved (owner 2026-10-01: bulk = assignment only, no server-side mass join)
branch: task/groups-filters-bulk-assign-2026-10-01 (from fix/join-skip-tab-2026-10-01 3511bba)
model: session model (Opus 5.5), effort default
budget: 60M
---

# Groups screen — relevance filters, search, bulk assignment by daily limits

Owner 2026-10-01: «в группах сделаем фильтры по релевантности и поиску, так же массовое применение активных
аккаунтов для вступления согласно лимитам». Scope fork answered: **assignment only** — joining stays per-row
«Вступить» / the existing farm; no new mass or background join (remove-risky-tg stands).

Non-goals: new join paths, changing pacing caps, changing tab rules (`docs/join-pipeline.md` §6), redesign of the page.

## Existing — do not recreate
- `app/app/page.tsx::listRows` (groups filter by tab), `query` toolbar search (crude `JSON.stringify` match),
  tab chips, `groupSelected` + select-all + actionbar (Аккаунт / Назначить / Смешать), `openAccountPicker`,
  `assignAccountsToGroups`, row `groups-why` line (score · reason from `joinGateFor`).
- `lib/group-tabs.ts` (`groupTab`, `groupInTab`), `lib/join-relevance.ts::joinGateFor` / `RelevanceBand`
  (`auto ≥60`, `review ≥35`, else `skip`), `data.joinRelevance{score,band,reasons}`.
- `app/api/workspace/route.ts` action `assign_group_accounts` (modes `single` | `mix`, `listJoinFarmCandidates`).
- `lib/join-pacing.ts::joinsLeftToday` / `effectiveJoinCap` / `warmupCap` / `accountAgeDays`;
  `lib/telegram-accounts.ts::hasInviteQuota`; `workspace-nav.tsx::persistWorkspaceView` (URL via `history.replaceState`).

## Requirements (EARS)
- **REQ-1** WHILE the groups view is open THE system SHALL offer a relevance filter «Все / Рекомендуем / На
  подтверждение / Не вступать» matching `joinRelevance.band` `auto` / `review` / `skip` (groups without a
  score match only «Все»), a minimum-score filter (0–100) and a sort «По умолчанию / Релевантность ↓ / ↑»
  (unscored last in both directions).
- **REQ-2** WHEN the user types in the search THE groups list SHALL match case-insensitively on name
  (title/username), url and relevance reasons only (not the whole JSON); other views keep current search.
- **REQ-3** THE tab chip counts SHALL reflect search + relevance filters (tab rule unchanged); WHEN any filter is
  active THE system SHALL show «Сбросить фильтры» which clears search, band, min score and sort; WHEN the
  filtered list is empty THE system SHALL show an empty state naming that filters hide groups, with the reset.
- **REQ-4** THE filter state (search, band, min score, sort, tab) SHALL live in the URL query (`replaceState`,
  no navigation, back/refresh restores it); unknown/invalid values SHALL fall back to defaults.
- **REQ-5** WHEN the user runs «Распределить по лимитам» THE system SHALL target the selected groups, or, with
  nothing selected, every group in the current filtered list (confirm with the count), and SHALL assign only
  active join-farm accounts (`listJoinFarmCandidates`), each receiving at most its remaining capacity today.
- **REQ-6** Remaining capacity of an account = `min(joinsLeftToday (warm-up incl.), invite quota left per
  hasInviteQuota limit)` minus groups already assigned to it that are not joined and not in error; the
  server is authoritative (new `assign_group_accounts` mode `by_limit`); the client preview uses the same pure helper.
- **REQ-7** Groups are taken in the visible order (sort applied, then higher score first for ties); groups
  already joined/pending are skipped; groups beyond today's total capacity SHALL stay unassigned (existing
  account untouched) and the response + UI message SHALL state «Назначено N, без аккаунта M — лимит на сегодня
  исчерпан (ёмкость K)»; IF total capacity is 0 THEN nothing is written and the message says so.
- **REQ-8** `by_limit` SHALL keep the existing validation (uuid lists, owner scoping, 500/200 caps) and be
  idempotent: re-running on the same set does not exceed any account's capacity.

## Helpers (pure, unit-tested) — `lib/group-filters.ts`, `lib/join-capacity.ts`
`parseGroupFilters(params) / serializeGroupFilters(f)`, `groupMatchesFilters(group, f)`, `sortGroups(rows, sort)`;
`accountJoinCapacity(account, assignedOpen, now)`, `planAssignmentByLimit(groups, accounts, now) →
{assignments, unassigned, capacity}` (spread: most remaining capacity first, round-robin).

## UI states
Filter bar under the tab chips (reuse `Input`, `NativeSelect`/`Select`, `Button` — no new primitives); disabled
bulk button with hint when 0 active accounts; loading on the button while the request runs; result toast/inline
message (REQ-7); error message from the API. Viewports: 1440, 768, 390 (filters wrap, no horizontal scroll).

## Assumptions
| id | assumption | evidence | if wrong → | conf |
|---|---|---|---|---|
| A-1 | Capacity uses both caps (warm-up and invite limit) | join-pacing.ts:74, telegram-accounts.ts:354 differ (20 vs 10) | over-assign → joins fail on quota | high |
| A-2 | Open assignments consume today's capacity | none — repeated bulk would otherwise pile up | under-assign; owner re-runs tomorrow | med |
| A-3 | "Active" = `isJoinFarmCandidate` | route `assign_group_accounts` | wrong pool | high |

## Verification
RED first: `tests/group-filters.test.ts`, `tests/join-capacity.test.ts`, `tests/join-account-selection.test.ts`
(`by_limit` cases: caps, warm-up, overflow unassigned, idempotent re-run, 0 capacity, foreign ids). Gate: lint,
`tsc --noEmit`, vitest, build — base is red before this task (lint 291, tsc 85, 1 join-pacing test): no new
failures. UI: ui-qa on a prod build at 3 viewports; security-reviewer on the route diff; port to staff-test + smoke.
NOT verified by design: real Telegram joins (out of scope).
