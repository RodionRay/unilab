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
| catalog niches, none ours, no strong term | −20 |
| stop-word in the title (only without strong terms) | −30 |
| < 300 subscribers | −5 |
| no topical evidence at all | capped at 30 |

Bands (`RELEVANCE_AUTO_MIN` = 60, `RELEVANCE_REVIEW_MIN` = 35): **auto** joins by itself,
**review** («На подтверждение») waits for the owner, **skip** («Не вступать») is not joined. Nothing is
deleted: every parked group stays in the list with its score and reason. Settings without product
config switch the filter off (everything auto).

`joinGateFor(group)` is the single decision used by the server and the UI: joined/pending groups are
always allowed and never rescored — so is a group whose membership was reset by an account swap
(`joinRejoin`, set by heal reassign / restore-previous and by scan rotations, cleared on the next
successful join; `seedRejoin` migrates older groups that have `joinedAccountId` but lost membership).
A dead link and the owner's «не вступать» still win over a rejoin; rejoins are scored for queue order; owner decisions (`joinDecision`: `approved` / `skipped`) beat the
score; a dead link (`joinDead`) is never auto-joined; a group without a score is parked, not joined blind.
Queue order: `compareJoinPriority` — approved first, then score, then subscribers.

Where it applies (`app/api/workspace/route.ts`):
- `healDeadGroupAccounts` (auto-heal / `rescan_groups` / cron) refreshes stale scores
  (`refreshGroupRelevance`), queues only allowed groups, best first, clears the queue state of parked ones;
- `join_group` scores a group that has no fresh score yet (added after the last heal, settings changed),
  answers `409 {parked:true}` for a parked group and never calls the worker for it;
- `enqueue_joins` queues only allowed groups; `manual:true` (the owner pressed «Вступить», imported or
  picked from the catalog) is an approval;
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
(`planJoinFarm`), and reserves it with a compare-and-swap on the account row (`reserveJoinAccount`) so
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

`recordUsernameMissing` counts the distinct accounts that could not resolve a group; the next attempt
goes only to an untried account (join: farm `exclude`; scan: rotation). After
`USERNAME_DEAD_AFTER_ACCOUNTS` = 3 the group is marked `joinDead` and leaves the auto-queue with the
reason «Ссылка не открывается …». Approving it (or editing its link) clears the mark and retries.
`seedMissingAccounts` migrates groups that failed before tracking existed. When every usable account is
already in the tried list the group is marked dead at once (small farms); when untried accounts exist but
are capped/paused the group is deferred (`409 {deferred:true}`, retried in 30 min) — never reported as a
farm-wide limit.
