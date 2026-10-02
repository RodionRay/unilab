#!/usr/bin/env bash
# One screenshot round: seed full VK data → all states; seed without VK → empty states (Telegram-only look).
#   round.sh <out-dir>    (stand must be running on UIQA_WEB_PORT, default 5241)
set -euo pipefail
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$1"; PORT="${UIQA_WEB_PORT:-5241}"
STORAGE="${UIQA_STORAGE:-${TMPDIR:-/tmp}/unilab-uiqa-storage.json}"
node "$TOOLS/mint-session.mjs" --out "$STORAGE" >/dev/null
node "$TOOLS/seed.mjs"
node "$TOOLS/capture.mjs" --url "http://127.0.0.1:${PORT}" --storage "$STORAGE" --out "$OUT"
node "$TOOLS/seed.mjs" --empty-vk
node "$TOOLS/capture.mjs" --url "http://127.0.0.1:${PORT}" --storage "$STORAGE" --out "$OUT/no-vk" --states leads-all,accounts,groups
node "$TOOLS/seed.mjs"
