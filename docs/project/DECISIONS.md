# Decisions ledger (one line each, ≤300 chars; detail in docs/adr/D-n-*.md)

- D-1 2026-10-01 Telegram Mini App auth = per-workspace bot-token HMAC on initData → 1 h in-memory bearer (no cookie); only linked members (one-time /start code or Login-Widget row). Spec docs/project/specs/tg-mini-app.md.
- D-2 2026-10-01 Mini app actions = web role ∩ `lib/tma/contract.ts::TMA_ACTIONS`; no deletes/settings/staff; auto-rescan read-only (toggle → v1.1).
- D-3 2026-10-01 New component family `components/tma/*` (Telegram-native look via `--tg-theme-*` + UniLab accent) instead of reusing desktop `components/product/*`: different host, viewport and navigation model.
- D-4 2026-10-02 One bot token shared by several workspaces is unsupported for linking: their pollers consume each other's /start updates, so the member has to retry. Follow-up: route /start by code owner across workspaces.
- D-5 2026-10-02 Private (DM) notices follow the workspace notices switch (`settings.notifyEnabled`); when it is off, settings show it via link status `noticesOff` instead of a separate DM switch.
- D-6 2026-10-02 Mini app URLs (menu button, DM «Открыть») are built only from a public https `APP_URL`, never from the request origin/Host: a Host-derived URL would let a caller point members' mini app at any host.
- D-7 2026-10-02 Mini app has no «Отправить всё равно» after a send with unknown outcome (504): it shows «Статус неизвестен — проверьте в Telegram» and the 15-min hold; force-resend (client `force` + 409 flags) → v1.1.
