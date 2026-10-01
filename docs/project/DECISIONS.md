# Decisions ledger (one line each, ≤300 chars; detail in docs/adr/D-n-*.md)

- D-1 2026-10-01 Telegram Mini App auth = per-workspace bot-token HMAC on initData → 1 h in-memory bearer (no cookie); only linked members (one-time /start code or Login-Widget row). Spec docs/project/specs/tg-mini-app.md.
- D-2 2026-10-01 Mini app actions = web role ∩ `lib/tma/contract.ts::TMA_ACTIONS`; no deletes/settings/staff; auto-rescan read-only (toggle → v1.1).
- D-3 2026-10-01 New component family `components/tma/*` (Telegram-native look via `--tg-theme-*` + UniLab accent) instead of reusing desktop `components/product/*`: different host, viewport and navigation model.
