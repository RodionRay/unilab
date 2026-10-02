# Spec: lead «вероятно заблокировал» + account penalty journal

status: built (branch `task/lead-block-account-penalties-2026-10-01`) · size: full · owner GO 2026-10-01

## Why
Telegram gives no direct «this user blocked you» signal (`users.getFullUser.blocked` is only about peers WE
blocked), and the account record keeps only the current penalty state — history was lost on every update.

## A. Lead «вероятно заблокировал» (`lib/lead-block.ts`)
Stored in `lead.blockSignal` (server-owned: `lib/processes/scan-flow.ts::SERVER_OWNED`), per (peer, our account):
a signal from another account starts a fresh baseline.

| Reason code | Source | Badge |
|---|---|---|
| `deleted` | send `errorCode` INPUT_USER_DEACTIVATED or `peer.deleted` | «Аккаунт удалён» |
| `blocked_error` | send `errorCode` USER_IS_BLOCKED | «Вероятно, заблокировал» |
| `privacy` | USER_PRIVACY_RESTRICTED / PRIVACY_PREMIUM_REQUIRED | «Вероятно, закрыл ЛС» |
| `profile_hidden` | status and photo seen before by this account, now UserStatusEmpty + no photo | «Вероятно, заблокировал» |
| `unread_seen_online` | our top message unread (`read_outbox_max_id`) while the peer was online ≥1 h after it | «Вероятно, не читает» |

- Not a block signal on its own: a peer seen online after our message cannot have blocked us (a blocked
  account does not see status), so `unread_seen_online` is labelled «не читает», not «заблокировал».
- Cleared by: a delivered DM (send-error reasons and `deleted`), visible profile again (`profile_hidden`), message read
  (`unread_seen_online`), an incoming DM from that peer on the same account (all but `deleted`).
- Inputs, no extra polling: the send result (`telegram-worker/src/check_account.py::send_message` → `errorCode`,
  `peer` = `peer_snapshot`), mailing outreach (`route.ts::recordMailingOutreach`) and the batched check
  `route.ts::checkLeadBlocks` → worker `/peer-status` (`check_account.py::peer_status`, one GetPeerDialogs,
  ≤50 peers with this account's access hash). Cadence: cron `auto-rescan` posts `check_lead_blocks` once per
  tick; one account per call; a conversation is re-checked at most every `LEAD_BLOCK_RECHECK_MS` (6 h) and only
  while our last DM is within `LEAD_BLOCK_ACTIVE_MS` (30 days). Leads of unusable accounts are stamped and skipped.
- UI: `components/product/lead-block-badge.tsx::LeadBlockBadge` in the lead row and in the conversation header
  (with the reason line); tooltip states it is an estimate.

## B. Account penalty journal (`lib/account-events.ts`)
- Table `account_events` (`drizzle/0002_account_events.sql`, `db/schema.ts::accountEvents`; additive; also created
  lazily by `ensureAccountEventsTable`). Types: spamblock (PEER_FLOOD), flood_wait (+`wait_sec`), spambot,
  frozen, write_ban, privacy, peer_blocked. Contexts: join, mailing, invite, dm, chat, check, collect, scan,
  peer_check, inbox, profile.
- `privacy` and `peer_blocked` are recipient-side (`RECIPIENT_EVENT_TYPES`): listed in the journal, excluded from the
  24h/7d/all penalty counters. Per-user privacy results inside an invite batch are not journaled (one per invited
  user, recipient-side; they stay in the invite task log).
- Idempotent: unique `(owner, dedupe_key)`, key = account · type · context · subject · minute.
- Written by `route.ts::journalPenalty` (never throws) at: account check (`runAccountCheck`, @SpamBot/frozen, only
  when the status changes — re-checks of a restricted account are not new penalties), `join_group`, `scan_group`,
  audience join + collect, invite target/source join, `tick_invite`, `tick_mailing` (subject = recipient),
  `send_lead_message` (dm/chat), `pollDmReplies` (inbox), profile/photo updates (frozen on change), `checkLeadBlocks`.
- Read: GET `/api/workspace` → `accountPenalties` (one GROUP BY: 24 h / 7 d / all / lastAt; only for actors with
  the accounts section); POST `account_events {accountId, limit≤200}` → newest first (authz `accounts`, read-only).
- UI: column «Штрафы» in the accounts table (`AccountPenaltyCell`), click → `AccountPenaltyDialog` with dates.

## Acceptance (REQ → evidence)
| REQ | Evidence |
|---|---|
| A1 send USER_IS_BLOCKED → lead badge + journal row | `tests/lead-block-route.test.ts` |
| A2 visible→hidden profile in batched check → `profile_hidden`; no re-check within 6 h; one worker call | `tests/lead-block-route.test.ts` |
| A3 heuristics, clearing, per-account baseline | `tests/lead-block.test.ts` |
| A4 worker codes, snapshot, ≤50 peers, FloodWait | `telegram-worker/tests/test_peer_block.py` |
| A5 UI save keeps `blockSignal` | `tests/lead-block-route.test.ts` |
| B1 classification of worker answers | `tests/account-events.test.ts` |
| B2 idempotent minute dedupe, counters, owner isolation, list cap | `tests/account-events.test.ts` |
| B3 FloodWait on DM journaled once with seconds; GET counters | `tests/lead-block-route.test.ts` |
| B4 UI cell/labels | `tests/lead-block-badge.test.ts` |
| B5 journal at check (once per status change), inbox; recipient events not counted; authz | `tests/lead-block-route.test.ts` |
| A6 FloodWait in batched check → `floodUntil`, account skipped; stale hash cleared; dead account stamped; incoming clears | `tests/lead-block-route.test.ts`, `test_peer_block.py::test_stale_hash_is_isolated_by_halving` |

## Known limits
- Journal hooks at join/scan/collect/invite/mailing/profile are covered by the classifier tests, not by a route test
  each.
- Lead creation through the generic `save` does not strip server-owned fields (pre-existing; same tenant only).
- DM-send spamblock is journaled but (as before) not applied to the account status; out of scope.
- No retention: `account_events` grows ~one row per penalty; counters use the `(owner, account_id, at)` index.
