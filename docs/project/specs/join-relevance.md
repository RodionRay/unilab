---
slug: join-relevance
size: full
status: implemented (awaiting review + live Telegram check)
branch: task/join-relevance-2026-09-30 (based on task/lead-stopwords-fix-2026-09-30)
model: session model (Opus 5.5), effort default
budget: 600M
---

# Join relevance gate + safe fast joining

Owner request 2026-09-30: stop auto-joining everything (off-niche SMM/marketing blogs yield zero leads),
prioritise on-topic groups, keep joining safe but fast. Reference: `docs/join-pipeline.md`.

## Requirements (EARS)

- **R1** WHEN a group is not joined THE system SHALL score it against the product settings and
  auto-join only the `auto` band; `review` waits for the owner, `skip` is not joined; every parked group
  stays listed with score and reason; joined groups are never re-scored or dropped.
- **R2** THE join queue SHALL be ordered by owner approval, then score, then size; a one-off re-score of
  the existing queue SHALL be available (`rescore_join_queue`, `scripts/rescore-join-queue.ts`).
- **R3** THE farm SHALL join in parallel across accounts and serially per account and per proxy, with a
  per-account daily cap (20 aged, warm-up 5/10/15), randomized 6–15 min gaps, exact FloodWait + margin,
  PEER_FLOOD → spamblock, CHANNELS_TOO_MUCH → 7-day stop, 4 consecutive errors → 6 h pause, and SHALL log
  throughput per tick.
- **R4** WHEN «Слот не видит @» comes from 3 distinct accounts THE system SHALL mark the group dead and
  stop retrying it; retries go only to untried accounts.
- **R5** THE groups list SHALL show band/score/reason and offer approve / skip per row and in bulk.

## Evidence matrix

| REQ | Tests |
|---|---|
| R1 | `tests/join-relevance.test.ts`; `tests/join-queue-route.test.ts` (heal gate, join_group 409, form save) |
| R2 | `tests/join-relevance.test.ts` (order); `tests/join-queue-route.test.ts` (rescan order, rescore counts) |
| R3 | `tests/join-pacing.test.ts`; `tests/join-queue-route.test.ts` (FloodWait, jitter, PEER_FLOOD, farm hand-off); `tests/cron-join-parallel.test.ts`; `telegram-worker/tests/test_join_limits.py` |
| R4 | `tests/join-dead-username.test.ts`; `tests/join-queue-route.test.ts` (join + scan caps) |
| R5 | build + manual check on the local stand (design-panel: n/a — one status reuse, one muted reason line and two existing-style buttons in an existing row) |

NOT verified: real Telegram joins (FloodWait/PEER_FLOOD paths are covered by stubbed worker answers only).
