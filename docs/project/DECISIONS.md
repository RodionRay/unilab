# DECISIONS (append-only ledger; detail in docs/adr/ when needed)

- 2026-10-02 D-triage: «Лиды» triage = existing lead `status` (new→«Новые», working→«Лиды», archived→«Отклонённые»), never changed by opening; moved by manual actions (`set_lead_triage`) and, as before, by a started conversation (our sent message, client reply, mailing/inbound-DM card → «Лиды»); `viewed` is a read marker. No schema/data migration: auto-viewed `new` leads return to «Новые», leads with a conversation are already `working`. Spec: specs/manual-lead-triage.md.
