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
accountBlind:true}`; the UI join queue (`app/app/page.tsx::startBackgroundJoins`) shows it as a note, not an error.
A successful join clears `joinBlindAccounts`. Without the pause `planGroupHeal` re-enqueued the group on every heal
tick — an endless join spinner, an account rotation and a red toast each time, one farm account burned per tick.
