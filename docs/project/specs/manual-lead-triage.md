---
status: in-progress
size: quick
model: session model (inherit)
budget: 60M tokens
branch: task/manual-lead-triage-2026-10-02
---
# «Лиды»: manual triage instead of auto-move on open

Owner 2026-10-02: «нужно в ручном режиме перемещать их в лиды, а то один раз просмотрел и они сразу в просмотренных,
а может этот лид хороший».

## Before
Opening a lead (`openLead` → `mark_lead_viewed`, `lib/lead-conversation.ts::markLeadOpened`) sets `viewed`; the
«Все»/«Новые» tabs hide viewed leads (`lib/lead-search.ts::leadVisibleInTab`), so one look moves a lead to
«Просмотренные». Status (`new|working|archived`) is only editable in «Правки».

## Model (D-2026-10-02-triage)
Triage state = the existing `status` field, no new column, no data migration:
`new` → «Новые» (untriaged) · `working` → «Лиды» (qualified) · `archived` → «Отклонённые».
`viewed` stays a read marker only (unread dot), it never filters the «Лиды» page.
Existing data: auto-viewed `new` leads land in «Новые» by themselves (staff-test 2026-10-02: 364 of 392);
leads with a conversation are already `working` (send/incoming DM set it) → «Лиды».
A started conversation keeps moving `new` → «Лиды» as before (`lib/lead-conversation.ts::applySendOutcome`,
`::mergeIncomingDm`, mailing / inbound-DM cards are created `working`): writing to the client is itself a decision.
Nothing else moves a lead; «Правки» can still set the status directly.

## Requirements (EARS)
- REQ-1 WHEN a manager opens a lead THE system SHALL NOT change its triage tab; it only marks it read.
- REQ-2 THE «Лиды» page SHALL show tabs «Новые · Лиды · Отклонённые · Все», each with its count; temperature,
  group and search are combined with the tab and counted in the tab numbers. Nav badge «Лиды» = unread untriaged.
- REQ-3 THE lead card and every list row SHALL offer the two triage actions other than the current one
  («В лиды», «Не подходит», «Вернуть в новые»).
- REQ-4 WHEN rows are selected THE page SHALL show a bulk bar «Выбрано N» with the same actions + «Снять».
- REQ-5 Every triage action SHALL be reversible: toast «Отменить» (bottom-center, 8 s) restores the previous status of
  each lead still where the action put it (`lib/lead-triage.ts::planTriageUndo`).
- REQ-6 API `set_lead_triage {ids[1..500], triage}`: owner-scoped, idempotent, viewer 403, unknown ids reported;
  ≤2 SQL statements per 100 ids (`json_set` on status only); the client splits bigger selections into 500-id calls.
- REQ-7 Unread leads (not opened or client replied) SHALL be visually marked in the list.
- REQ-8 Overview: «Новые» = untriaged count, hot = hot untriaged, per-chat fresh = untriaged; the leads widget toggles
  «Новые / Лиды»; «Открыть в лидах» lands on the same tab + temperature. Legacy `filter:'viewed'|'hot'…` links map.
- REQ-9 «Переписки» keeps its own «Новые / Просмотренные» (unread/read) folders — unchanged.

## Verification
Unit: `lib/lead-triage.ts` (mapping, tabs, counts, goLeads mapping). Feature: `set_lead_triage` via route POST
(owner, idempotent repeat, viewer 403, foreign/unknown id, mark_lead_viewed does not change status).
UI: production build screenshots 1280/390 of tabs, row actions, bulk bar, card actions.
