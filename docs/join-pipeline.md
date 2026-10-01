# Join pipeline — blocked and blind accounts

How a group join (`app/api/workspace/route.ts` action `join_group`, heal `healDeadGroupAccounts`) treats accounts
that Telegram restricted. Pure decisions live in `lib/processes/join-flow.ts`.

## 1. Blind answer defers the group

The worker answers `accountBlind:true` when the group @username does not resolve AND the control @telegram does not
resolve either (`telegram-worker/src/check_account.py::_resolve_entity`): the slot is restricted, the group is not to
blame. The account gets `accountBlindPatch` (6 h `resolveBlindUntil`).

The group is deferred, not failed: `join-flow.ts::accountBlindDeferPatch` sets status `setup` (not `error`), records
the witness in `joinBlindAccounts` and sets `joinNextAt` = `JOIN_WORKER_ERROR_RETRY_MS` (15 min) after the first
blind witness, `ACCOUNT_BLIND_COOLDOWN_MS` (6 h) from the second. The reply is `409 {deferred:true,
accountBlind:true}`; the UI join queue (`app/app/page.tsx::startBackgroundJoins`, verdict from
`lib/join-reply.ts::classifyJoinReply`) shows it as a note, not an error. The same holds for a join answered
`accountFrozen` / `reassigned` (200 `ok:false`): no error, no failure count, and its `rejoinItem` is queued again.
A successful join clears `joinBlindAccounts`. Without the pause `planGroupHeal` re-enqueued the group on every heal
tick — an endless join spinner, an account rotation and a red toast each time, one farm account burned per tick.

## 2. Accounts deleted by Telegram — status `deleted`

A deleted account still logs in, but other users see «Удалённый аккаунт» and it resolves no @username, so it stayed
`active` and kept getting joins. The status `deleted` («Удалён Telegram», `lib/telegram-accounts.ts::ACCOUNT_STATUSES`)
is never usable: `isAccountUsable`, `canPollDmInbox`, `join-flow.ts::evaluateAccountJoinReadiness` (reason
`deleted`), `scan-flow.ts::HARD_DEAD`, the mailing/invite stop-% dead lists and
`join-flow.ts::PERMANENT_DEAD_ACCOUNT_STATUSES` (so `planGroupHeal` reassigns its groups to live accounts).
`applyQuotaCooldownIfExhausted`, `apply_account_profiles` and `upload_account_photos` never overwrite it.

- Hard signals set `deleted` (worker `telegram-worker/src/check_account.py::check_account`): `get_me().deleted`, or a
  check that raises `USER_DEACTIVATED(_BAN)` (`is_account_deactivated` in `run_check`; other actions keep
  `classify_error`'s verdict).
- Soft signal — @telegram AND @durov (`DELETED_CONFIRM_USERNAME`) both «not occupied» (`_control_outcome` =
  "blind"; FloodWait / network on a control = "unknown", no signal): the worker answers `status:'active', deletedSuspect:true`.
  `route.ts::saveControlBlindVerdict` stores the first-seen time in `controlBlindSince`; the account is out of every
  use at once (`isDeletedSuspect`), and becomes `deleted` only when a later check sees the same at least
  `DELETED_CONFIRM_AFTER_MS` (6 h) after the first. Payload `checkDeleted:false` skips the control resolve.
- A blind join answer does not set `deleted`: it stamps `deletedSuspectAt` (`join-flow.ts::deletedSuspectPatch`).
  «Перепроверить проблемные» (`needsAccountRecheck`, UI and `check_accounts mode:'problem'`) includes suspects.
- Revival only on a positive control: a clean `active` check clears the soft signs (`clearedSuspectPatch`) and
  revives `deleted` only when the worker's @telegram control resolved (`controlOk:true`, `_control_outcome` = "ok").
  An inconclusive control (`controlUnknown`: FloodWait / network, or only @durov resolved, or a worker without the
  field) keeps the soft signs, a blind error and `deleted`; a check that fails to connect (`disconnected` /
  `proxy_error`, FloodWait included) keeps `deleted` too (`route.ts::keepDeletedAfterFailedCheck`). The accounts table shows «Не видит @telegram — не
  используется, перепроверка через N ч» (`suspectRecheckHours`).
- An account form save never sets or clears `deleted` or the server-owned block fields `deletedSuspectAt`,
  `controlBlindSince`, `resolveBlindUntil` (`telegram-accounts.ts::keepServerOwnedAccountFields`, applied in the
  `save` action); the status select has no `deleted` option.
- Purge — action `delete_telegram_deleted_accounts` with `ids` (`route.ts::deleteTelegramDeletedAccounts`, UI
  «Удалить удалённые Telegram (N)»: the id list is frozen when the confirm opens, the confirm names N and sends
  exactly those ids): deletes only those ids whose
  status is still `deleted` inside the owner-scoped DELETE (the session lives in the record `secret`, so it goes too).
  The DELETE and every reference UPDATE run as one D1 `batch` (one transaction); refs are cleared only for
  candidates with no account record left. Side effects, each an owner-scoped conditional single-statement UPDATE (a concurrent heal / join reassignment or
  task edit is kept): `accountId` and `joinedAccountId` cleared on groups (heal reassigns joined and owner-queued
  ones), `accountId` on leads, `sourceAccountId` on audience tasks; the ids leave `accountIds` of mailing / invite /
  audience tasks, and a running/scheduled task left with none is paused with «Все аккаунты задачи удалены Telegram …».
  An audit line with names, counts and the acting user id goes to the global rescan log. Irreversible; access rule `accounts`.

## 3. One join-block predicate — `lib/telegram-accounts.ts::accountTelegramBlock`

Rule: never join with an account that caught a Telegram block. Signals: status spamblock / frozen / deleted /
unauthorized; a live `resolveBlindUntil`; any soft deleted sign (`isDeletedSuspect`: `deletedSuspectAt`,
`controlBlindSince`, a `resolveBlindUntil` even when expired, an error starting with `BLIND_ERROR_PREFIX`) until a
clean recheck (`clearedSuspectPatch` also clears `resolveBlindUntil`); a live FloodWait (`joinFloodUntil` or
`floodUntil`). `isAccountJoinBlocked` gates every join path:

- `join-flow.ts::evaluateAccountJoinReadiness` (`telegramBlockGate`, reasons `resolve_blind` / `flood` / `deleted` /
  `spamblock` / `frozen` / `unusable`) and so `isJoinFarmCandidate` (join farm, heal `listJoinTargetIds`, reassign
  targets); join_group answers `429 {flood:true}` when no other farm account is ready.
- join_group peer refresh of a joined group on its own account: `409 accountUnavailable` with the block as reason.
- `planGroupHeal(accountJoinBlock, previousAccountJoinBlock)`: a pending group leaves a blocked account even while it
  waits (`joinNextAt`); a joined group leaves on any non-temporary block (not FloodWait / spamblock);
  `restore_previous` skips a blocked previous account.
- scan_group: a suspect account is treated as hard-dead; a blocked one scans with `allowJoin:false` (worker
  `scan_group(allow_join=False)` never joins a channel discussion). A blind scan answer (`accountBlind`, passed
  through by the worker) marks the account and leaves the group without an error (`409 skipped`).
- tick_audience and tick_invite slot lists skip blocked accounts; their blind join answers mark the account
  (`accountBlindPatch` + `deletedSuspectPatch`).
- A join answered `frozen` reassigns the group at once — a joined one too
  (`route.ts::rotateGroupOffDeadAccount(dropMembership)`) — without asking the owner.

When the worker cannot run the control itself (FloodWait / network on @telegram,
`check_account.py::_control_resolve_blind` → `None`, answer `controlUnknown:true`) neither the group nor the account
is blamed: join_group treats it as worker-transient (15 min retry, no attempt, status `setup`), scan_group answers
`409` with the group untouched.
