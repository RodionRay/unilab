# Join pipeline: relevance gate and pacing

How UniLab decides **which** Telegram groups the account farm joins and **how fast**.
Spec and acceptance criteria: `docs/project/specs/join-relevance.md`.

## 1. Relevance gate — `lib/join-relevance.ts`

Every group that is not joined yet gets a score 0–100 (`scoreGroupRelevance`) against the product
settings (`product`, `keywords`, `hotSignals`, `leadCriteria`, `audience`, stop-lists), built once per
settings version by `buildRelevanceProfile`. Inputs known without joining: title, `@username`, catalog
niches / description / audience / subscriber count (`catalogEntryFor`, `membersFromText`), source
(`tgstat-*` = broadcast channel).

| Signal | Points |
|---|---|
| base | 25 |
| already produced leads (`leadsTotal`) | +20, ≥ 5 leads +30; counts as topical evidence |
| niche of the product (catalog niches, or inferred from the title outside the catalog) | +12 each, ≤ 36 |
| strong term (keywords, hot signals, audience, everyday niche names: wb, озон, селлер, мойсклад …) | +14 each, ≤ 42 |
| weak product word | +6 each, ≤ 12 |
| chat (участники пишут сами) | +12 |
| broadcast channel / blog–media title | −15 / −10, and never above 59 (owner decides) |
| catalog niches, none ours, no strong term (not for business chats) | −20 |
| stop-word in the title (only without strong terms) | −30 |
| < 300 subscribers | −5 |
| no topical evidence at all (not for business chats) | capped at 30 |
| topical evidence (niche / strong term / leads) or a business chat | never below 35 (review) |

A **business chat** is a chat (not a broadcast channel) whose catalog niches include `business` or whose
title matches «бизнес» / «предприним»: sellers ask there too, so it is never skipped silently — reason
«бизнес-чат: селлеры бывают — решите сами». Business broadcast channels are scored as before.
`JOIN_RELEVANCE_VERSION` = 3: stored scores of older versions are recomputed (`isRelevanceStale`).

Bands (`RELEVANCE_AUTO_MIN` = 60, `RELEVANCE_REVIEW_MIN` = 35): **auto** joins by itself,
**review** («На подтверждение») waits for the owner, **skip** («Не вступать») is not joined. Nothing is
deleted: every parked group stays in the list with its score and reason. Settings without product
config put every group in review — never a blind auto-join.

`joinGateFor(group)` is the single decision used by the server and the UI: joined/pending groups are
always allowed and never rescored — so is a group whose membership was reset by an account swap
(`joinRejoin`, set by heal reassign / restore-previous and by scan rotations, cleared on the next
successful join; `seedRejoin` migrates older groups that have `joinedAccountId` but lost membership).
A dead link and the owner's «не вступать» still win over a rejoin; rejoins are scored for queue order; owner decisions (`joinDecision`: `approved` / `skipped`) beat the
score (`joinWanted: true` from the earlier «only owner-queued groups» rule counts as approval);
a dead link (`joinDead`) is never auto-joined; a group without a score is parked, not joined blind.
Queue order: `compareJoinPriority` — approved first, then score, then subscribers.

Where it applies (`app/api/workspace/route.ts`):
- `healDeadGroupAccounts` (auto-heal / `rescan_groups` / cron) refreshes stale scores
  (`refreshGroupRelevance`), queues only allowed groups, best first, clears the queue state of parked ones;
- `join_group` scores a group that has no fresh score yet (added after the last heal, settings changed),
  answers `409 {parked:true}` for a parked group and never calls the worker for it;
- `enqueue_joins` is the owner's intent («Вступить», import, catalog) and approves the group
  (`joinDecision: approved`, `joinWanted: true`); the client never sends automatic items (heal/rescan) there;
- `planGroupHeal` receives `joinWanted` = the gate's decision, so its `not_wanted` branch parks
  non-target groups (no queue, no account reassignment);
- `set_group_join_decision {groupIds, decision: approved|skipped|''}` — owner decision, reversible.
  Like manual joins before this change, any workspace member with `groups` access may approve
  (`lib/security/workspace-authz.ts`); approving also clears a dead-link mark (explicit retry);
- `rescore_join_queue` — one-off re-score of the whole queue (force), returns band counts.

Offline equivalent for a local D1/SQLite file: `npx tsx scripts/rescore-join-queue.ts --db <file>`
(dry-run; `--apply` writes a backup of every touched group row first — to `--backup <file>` or the OS
temp dir, never the repo — then updates only group rows).

## 2. Pacing — `lib/join-pacing.ts`

Parallel across accounts, serial per account and per proxy.

| Rule | Value | Why |
|---|---|---|
| daily cap, aged account | 20 (`JOIN_DAILY_CAP_AGED`); a lower `limits.invite` wins | 15–25 joins/day is the usual safe band for user sessions |
| warm-up by days in the farm | < 3 d → 5, < 7 d → 10, < 14 d → 15 (`JOIN_WARMUP_CAPS`) | fresh accounts get restricted first |
| gap per account | random 6–15 min; 15–30 min in the first week (`nextJoinGapSec`) | minutes, not seconds; no fixed period |
| per proxy | ≥ 90 s between joins, one reservation at a time (`PROXY_JOIN_GAP_SEC`) | one exit IP = one join at a time |
| FloodWait | exact seconds + 15 % (≥ 30 s) on that account only (`joinFloodPatch`) | Telegram's own number, with margin |
| PEER_FLOOD | spamblock 24 h (`withSpamblockStatus`) | spam filter hit — stop the account |
| CHANNELS_TOO_MUCH | no joins for 7 days (`channelsTooMuchPatch`) | account is in 500 chats |
| consecutive account-side errors | 4 → joins paused 6 h (`joinErrorPatch`) | stop hammering a sick session |
| failed attempt that reached Telegram (private, banned, dead link, worker error) | half a gap + proxy spacing, not counted in the cap (`joinAttemptPatch`) | a queue of bad links must not turn into back-to-back calls |

`join_group` picks the group's own account if ready, else the soonest ready farm account
(`planJoinFarm`; accounts whose proxy record is missing or inactive are excluded — the
`evaluateAccountJoinReadiness` rule), and reserves it with a compare-and-swap on the account row (`reserveJoinAccount`) so
parallel joins never share an account or a proxy. The cron (`app/api/cron/auto-rescan/route.ts`) runs
up to 4 joins at once (`JOIN_CONCURRENCY`, ≤ 8 per tick) and stops launching joins only on farm-wide
answers: `farmExhausted` / `limitReached` (caps everywhere), every account resolve-blind, or `pace`
without `retryOther` (every account inside its gap). When only the accounts that have not tried a group
yet are paced, the answer carries `retryOther` — the pause is that group's, not the farm's. Per-account answers (`retryOther`: FloodWait,
PEER_FLOOD, CHANNELS_TOO_MUCH) and per-group answers (`parked`, `deferred`) only skip that item.
A joined group whose peer is refreshed uses its own account: it waits for that account's timers and
reserves it like a new join. The tick summary logs throughput: joins today / farm cap, accounts
ready now, parked queue (`farmThroughput`).

The worker reports `join: "peer_flood"` / `"too_many"` explicitly
(`telegram-worker/src/check_account.py::join_limit_error`), classified in
`lib/processes/join-flow.ts::classifyJoinFailure`.

## 3. Dead usernames — «Слот не видит @»

`recordUsernameMissing` records the distinct accounts that could not resolve a group
(`joinMissingAccounts`); the next attempt goes only to an untried account (join: farm `exclude`; scan:
rotation, at most `USERNAME_DEAD_AFTER_ACCOUNTS` = 3 accounts per group). Witnesses alone never mark a
group dead — the farm often lies. `joinDead` is set only when t.me confirms the username is missing
(`tmeMissing`, §4); groups marked dead by the old witness rule stay as they are until approved or probed.
Approving a dead group (or editing its link) clears the mark and retries. `seedMissingAccounts` migrates
groups that failed before tracking existed. When every usable account is already in the tried list, or
untried accounts are capped/paused, the group is deferred (`409 {deferred:true}`, retried in 30 min) —
never reported as a farm-wide limit; in the first case it also gets an account error (§5).

## 5. Account-side join errors

A join that fails because of the account — resolve-blind (`accountBlind`), FloodWait, session/proxy
(`sessionFault`), worker transient, PEER_FLOOD, CHANNELS_TOO_MUCH, frozen, a worker exception, or
«Слот не видит @» before t.me confirmed the link dead — does not touch the group's `status` / `error`:
`lib/processes/join-flow.ts::accountSideJoinErrorPatch` keeps the previous non-error status (else
`setup`), clears `error` / `joinStateError` and stores `joinAccountError` (≤ 300 chars) +
`joinAccountErrorId` (the account). A successful join (`JOIN_SUCCESS_PATCH`, also used by approve and
restore) and `assign_group_accounts` with a different account clear both fields.
`clearAccountSideJoinError` migrates old groups on every `refreshGroupRelevance` (heal tick): a non-member,
non-dead group in status `error` whose texts are all account-side (or empty) goes back to `setup`, the text
moves to `joinAccountError`. Real group errors (private, banned, invite expired) keep status `error`.

## 6. Groups page tabs — `lib/group-tabs.ts`

`groupTab` puts each group in one tab; chip counts and the list filter use the same `groupInTab`:

| Tab | Rule (first match wins) |
|---|---|
| Заявки | membership / status `pending` |
| Вступили | member (`groupIsMember`; the filter also lists requests) |
| Ошибки | status `error`, gate `dead`, or `joinAccountError` |
| Ждут | gate allows, real link (not a catalog placeholder) — also without an account: the row shows «Назначить аккаунт» (row account picker) instead of «Вступить» |
| На подтверждение | gate `review` |
| Не вступать | gate `skip` / `skipped` only |

`groupStatusLabel`: queue state, then «Заявка» / «Вступили», then «Ошибка аккаунта» (`joinAccountError`),
«Ссылка мертва» (gate `dead`), «Ошибка» (status `error`), then the gate labels. A row with an account
error shows «Аккаунт <name> не смог вступить: <text>» and a «Другой аккаунт» button (row account picker).

## 4. Chats that do not exist — t.me probe (`lib/tme-probe.ts`)

The public preview page `https://t.me/<username>` answers without a Telegram account.
`classifyTmePage` (rule taken from real pages, 2026-10-01):

| Page | Result |
|---|---|
| `tgme_page_extra` with «N members» / «N subscribers» (chat, channel) | live |
| no such line, action button «Send Message» / «Start Bot» (missing username = «Contact @x» page without title and extra; a user; a bot) | dead |
| no `tgme_page_title` / `tgme_action_button` / `tgme_page_extra` markup (og:title alone does not count), any other button («View Chats» on addlist, «View in Telegram» on a restricted/scam channel without a count) | unknown |

`probeTmeUsername` never follows redirects (3xx, e.g. the t.me root → telegram.org, is unknown), treats
every non-200 as unknown, reads at most 256 KB of the body and retries only network errors. Invite
links and reserved first path segments (`addlist`, `share`, `iv`, `proxy`, `addstickers`, `joinchat`,
`c`, `s`, `contact`, `login`, `setlanguage`, …) are never probed (`probeableUsername`). Unknown never
drops a group.

The group stores `tmeProbe` (`live` / `unknown`; `dead` with `tmeMissing`) and `tmeProbeAt`.
`tmeProbeDue` (callers pass non-member groups only; members are never probed): dead is final; unknown is
retried after 30 min (`TME_UNKNOWN_RETRY_MS`), live after 7 days (`TME_LIVE_RECHECK_MS`).

- `join_group`: before joining a public @username with a due probe — and before the relevance gate, so a
  parked group is checked too — the server probes t.me once, synchronously, timeout 4 s. Dead → `settleDeadGroup`, answer `409 {parked, deadLink, gate:'dead', removed}`,
  no account is reserved or spent. Live / unknown → stored on the group, the join goes on.
- `settleDeadGroup` (route): `tmeMissingPatch` marks the group `joinDead` + `tmeMissing` with the copy
  «Чат @x не существует в Telegram» (also the gate reason in `joinGateFor`). Without leads
  (`leadsTotal` 0 and no lead with its `groupId`) the group record is deleted and a tombstone
  (`kind='dead_group'`, `data.key` = `telegramEntityKey(url)`) is inserted only if none exists for that key.
- `purgeDeadGroups` runs only on the heal tick (`healDeadGroupAccounts`: cron, `rescan_groups`,
  `heal_dead_group_accounts` — actions with groups write access), never on `GET`. It deletes confirmed
  dead groups without leads and probes up to 4 non-member public @username groups with a due probe (any
  band: auto, «На подтверждение», «Не вступать», witness-dead; catalog placeholders excluded), never-probed
  first, then the least recently probed (rotation), in parallel. A group the farm «does not see» but t.me shows
  alive keeps the witness rule of §3.
- Tombstones: `GET` returns `deadGroupKeys` (not in `records`) only to actors who can see groups
  (`lib/security/workspace-authz.ts::canViewKind`), else `[]`. The catalog dialog hides and never saves
  those chats; `import_catalog` skips them; `save` of a new group with `source` `catalog` / `tgstat-*`
  (the catalog dialog sends `source: 'catalog'`) and a tombstoned link answers `409 {deadLink}` and keeps
  the tombstone — a client with stale `deadGroupKeys` cannot bring the chat back.
- Any other recommended / catalog view must filter tombstones the same way (`deadGroupKeys`,
  `telegramEntityKey`). Merge note: `lib/catalog-recommend.ts::buildRecommendedView` on
  `task/catalog-recommended-2026-10-01` does not know about tombstones yet — whoever merges it must
  filter its result by `deadGroupKeys`.
- Undo: a manual save (no catalog `source`) of a new group, or a link change, whose link has a tombstone
  deletes the tombstone (`forgetDeadGroup`); the next join probes t.me again. A client without the
  `source` field counts as manual; if the chat is still dead the next probe removes it again. Approving a kept dead group clears
  `tmeMissing` / `tmeProbe` / `tmeProbeAt` (explicit retry).
- Catalog upkeep: `npx tsx scripts/probe-catalog.ts [--json]` probes every catalog username
  (concurrency ≤ 4) and lists dead / unknown ones for removal from `lib/group-catalog.ts`.

## 7. Groups page filters and «Распределить по лимитам»

Spec: `docs/project/specs/groups-filters-bulk-assign.md`. Bulk = assignment only; joining stays per row
(«Вступить») and the farm — no new mass or background join.

### Filters — `lib/group-filters.ts`

| URL param | Values (anything else → default) | Rule |
|---|---|---|
| `g_q` | text, ≤ 200 chars (`GROUP_SEARCH_MAX`) | case-insensitive substring of `name`, `username`, `url` or a `joinRelevance.reasons` entry (`matchesSearch`), not the whole JSON |
| `g_band` | `all` · `auto` (Оценка «Высокая») · `review` («Средняя») · `skip` («Низкая»); labels show the thresholds from the same constants | `joinRelevance.band`, else derived from `score` (`RELEVANCE_AUTO_MIN` / `RELEVANCE_REVIEW_MIN`, §1); unscored groups match only `all` |
| `g_min` | integer 0–100 (`^\d{1,3}$`, ≤ 100) | score ≥ min; with min > 0 unscored groups are hidden |
| `g_sort` | `default` · `score_desc` · `score_asc` | `sortGroups`: stable by score, unscored last in both directions |
| `g_tab` | `all` · `need` · `review` · `skip` · `joined` · `pending` · `error` | the tab of §6 (`groupInTab`), applied after the filters |

- `parseGroupFilters` reads the query (invalid → `DEFAULT_GROUP_FILTERS`); `serializeGroupFilters` writes only
  non-default values and keeps foreign params (`view`, …). `app/app/page.tsx::WorkspaceHome` keeps the state in
  the URL with `history.replaceState` (no navigation; refresh/back restore it); leaving the groups view drops
  the `g_*` params.
- `groupMatchesFilters` = search + band + min; the list is `groupMatchesFilters && groupInTab`, then
  `sortGroups`. Tab chip counts use the same `groupMatchesFilters`, so they follow search and filters.
- Under a 640px list width (container query on `.groups-page`) only the search and «Фильтры · N» stay in the
  bar (N = active оценка / балл / сортировка); the button reveals the rest.
- The groups view has its own search in the filter bar; the global toolbar (search + worker badge) is not
  rendered there — the worker badge sits at the end of the groups action row — and the toolbar search keeps
  its `JSON.stringify` match on other views.
- `groupFiltersActive` (search, band, min, sort — not the tab) shows «Сбросить фильтры» in the bar; it resets
  those four and keeps the tab. An empty filtered list names the active filters and offers the reset.

### `assign_group_accounts` mode `by_limit` — `lib/join-capacity.ts`

Button «Распределить по лимитам» in the groups actionbar: targets the selected groups (in the visible order),
or — nothing selected — every group of the current filtered list, at most 500 per request (zod cap; the page
sends the first 500, `BY_LIMIT_MAX_GROUPS`). Disabled (opacity .5) with the link «Нет активных аккаунтов» → view «Аккаунты» when the join farm is empty.
The confirm dialog previews the plan with the same helpers the server uses (`page.tsx::byLimitPreview`).

- Pool: `route.ts::listJoinFarmCandidates` (`isJoinFarmCandidate`: ready or only paced); optional `accountIds`
  narrows it to the intersection. Empty pool → `400`.
- Capacity per account (`accountJoinCapacity`): `min(joinsLeftToday(account, ageDays)` — pacing cap with
  warm-up, §2 — `, invite quota left)` minus open assignments, never below 0. Invite quota left =
  `limits.invite` (default `DEFAULT_ACCOUNT_LIMITS.invite`, the `hasInviteQuota` limit) − `joinsToday`; a
  limit ≤ 0 means no own ceiling.
- Joinable (`groupJoinableByFarm`): the «Ждут» rule of §6 (`groupTab` = `need`): not a member or request, no
  join error, relevance gate open (§1), a real link (not a catalog placeholder). Only these are planned; the
  rest are `skipped` and use no capacity.
- Open assignments (`countOpenAssignments`): joinable groups with this `accountId`, excluding the groups being
  planned. Groups the farm will not join (low/medium score, errors, no link) never hold a slot.
- Plan (`planAssignmentByLimit`): first pass in the given order — a group already on a farm account keeps it
  and spends that account's capacity (`kept`); if that account is out of capacity the group stays as is and
  counts as unassigned. Second pass — groups without an account or with a non-farm account go round-robin over
  accounts, most capacity first (ties by id); each account gets at most its capacity; a non-farm account being
  replaced counts in `replaced`. Groups beyond the total stay **unassigned** — their current account is left
  untouched. A re-run on the written set keeps every group and writes nothing (idempotent).
- Target order (`lib/group-filters.ts::byLimitTargetOrder`, `page.tsx::byLimitTargetIds`): the visible order;
  rows equal under it (with no explicit sort — all rows) go higher score first, unscored last.
- Write (`route.ts::writeByLimitAssignment`): one `UPDATE … json_set` per row on `accountId`, `error`,
  `joinAccountError`, `joinAccountErrorId` only, guarded by the planned `accountId` and by membership/status — a
  join tick that landed between the plan and the write is never overwritten (the row is skipped). Only
  owner-scoped existing ids (unknown/foreign → `rejected`).
- Response: `{mode:'by_limit', updated, assignments, kept, replaced, unassigned, skipped, capacity, rejected,
  message}`; `updated` = rows actually written. `byLimitMessage` (N = written + kept): «Назначено N (ёмкость K)»,
  with overflow «Назначено N, не назначено M — лимит на сегодня исчерпан (ёмкость K)», with total capacity 0
  nothing is written and «Лимит на сегодня исчерпан у всех аккаунтов — ничего не назначено (ёмкость 0)»;
  skipped groups add «· пропущено S — не для вступления».
- Confirm dialog: «Назначим» (written + kept) / «Не назначено» / «Ёмкость сегодня», per-account bars, «Исчерпан
  лимит у N аккаунтов», «Сменим аккаунт: N», «Пропущено K — не для вступления»; «Распределить» is disabled when
  nothing would be written. Esc/«Отмена» return focus to «Распределить по лимитам».
  The page shows it as a dismissible line under the actionbar (warning tone on overflow or capacity 0).
