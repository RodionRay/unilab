---
slug: groups-filters-bulk-assign
size: quick
status: implemented (verification pending; owner 2026-10-01: bulk = assignment only, no server-side mass join)
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
- **REQ-1** WHILE the groups view is open THE system SHALL offer a filter «Оценка»: «Все / Высокая (≥60) /
  Средняя (35–59) / Низкая (<35)» matching `joinRelevance.band` `auto` / `review` / `skip` (URL values unchanged;
  groups without a score match only «Все»), a minimum-score filter (0–100) and a sort «По умолчанию / Оценка ↓ /
  ↑» (unscored last in both directions). Under a 640px list width the search stays visible and «Фильтры · N»
  (N = active оценка/балл/сортировка) reveals the rest.
- **REQ-2** WHEN the user types in the search THE groups list SHALL match case-insensitively on name
  (title/username), url and relevance reasons only (not the whole JSON); other views keep current search.
- **REQ-3** THE tab chip counts SHALL reflect search + relevance filters (tab rule unchanged); WHEN any filter is
  active THE system SHALL show «Сбросить фильтры» which clears search, band, min score and sort; WHEN the
  filtered list is empty THE system SHALL show an empty state naming that filters hide groups, with the reset.
- **REQ-4** THE filter state (search, band, min score, sort, tab) SHALL live in the URL query (`replaceState`,
  no navigation, back/refresh restores it); unknown/invalid values SHALL fall back to defaults.
- **REQ-5** WHEN the user runs «Распределить по лимитам» THE system SHALL target the selected groups, or, with
  nothing selected, every group in the current filtered list (confirm with the count), SHALL plan only groups the
  farm can join (the «Ждут» rule: not member/request, no join error, relevance gate open, real link) and report
  the rest as «пропущено K — не для вступления», and SHALL assign only active join-farm accounts
  (`listJoinFarmCandidates`), each receiving at most its remaining capacity today. A target already on a farm
  account keeps it and spends that account's capacity first; only groups without an account or with a non-farm
  account get a new one (preview: «Сменим аккаунт: N»). The dialog action is disabled when nothing would be written.
- **REQ-6** Remaining capacity of an account = `min(joinsLeftToday (warm-up incl.), invite quota left per
  hasInviteQuota limit)` minus groups already assigned to it that the farm can still join (same rule as REQ-5);
  the server is authoritative (new `assign_group_accounts` mode `by_limit`); the client preview uses the same pure
  helper.
- **REQ-7** Groups are taken in the visible order; groups equal under that order (all of them without an
  explicit sort) go higher score first, unscored last (`byLimitTargetOrder`). Groups beyond today's total
  capacity — or whose kept farm account is over capacity — SHALL stay unassigned (existing account untouched) and
  the response + UI message SHALL state «Назначено N, не назначено M — лимит на сегодня исчерпан (ёмкость K)»
  (N = written + kept); IF total capacity is 0 THEN nothing is written and the message says so. `updated` = rows
  actually written; a write only changes `accountId` and the error fields and is skipped if the group became a
  member/request or changed account since the plan.
- **REQ-8** `by_limit` SHALL keep the existing validation (uuid lists, owner scoping, 500/200 caps) and be
  idempotent: re-running on the same set does not exceed any account's capacity.

## Helpers (pure, unit-tested) — `lib/group-filters.ts`, `lib/join-capacity.ts`
`parseGroupFilters(params) / serializeGroupFilters(f)`, `groupMatchesFilters(group, f)`, `sortGroups(rows, sort)`;
`byLimitTargetOrder(rows, tieKey)`; `accountJoinCapacity(account, assignedOpen, now)`, `groupJoinableByFarm(data)`,
`planAssignmentByLimit(groups, accounts, now) → {assignments, kept, replaced, unassigned, skipped, capacity}`
(kept first, then spread: most remaining capacity first, round-robin).

## UI states
Filter bar under the tab chips (reuse `Input`, `NativeSelect`/`Select`, `Button` — no new primitives); disabled
bulk button with hint when 0 active accounts; loading on the button while the request runs; result toast/inline
message (REQ-7); error message from the API. Viewports: 1440, 768, 390 (filters wrap, no horizontal scroll).

## Assumptions
| id | assumption | evidence | if wrong → | conf |
|---|---|---|---|---|
| A-1 | Capacity uses both caps (warm-up and invite limit) | join-pacing.ts:74, telegram-accounts.ts:354 differ (20 vs 10) | over-assign → joins fail on quota | high |
| A-2 | Open assignments consume today's capacity — only groups the farm can still join (review 2026-10-02: skip/review/error groups held slots forever) | none — repeated bulk would otherwise pile up | under-assign; owner re-runs tomorrow | med |
| A-3 | "Active" = `isJoinFarmCandidate` | route `assign_group_accounts` | wrong pool | high |

## Verification
RED first: `tests/group-filters.test.ts`, `tests/join-capacity.test.ts`, `tests/join-account-selection.test.ts`
(`by_limit` cases: caps, warm-up, overflow unassigned, idempotent re-run, 0 capacity, foreign ids). Gate: lint,
`tsc --noEmit`, vitest, build — base is red before this task (lint 291, tsc 85, 1 join-pacing test): no new
failures. UI: ui-qa on a prod build at 3 viewports; security-reviewer on the route diff; port to staff-test + smoke.
NOT verified by design: real Telegram joins (out of scope).
