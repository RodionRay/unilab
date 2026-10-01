#!/usr/bin/env bash
# Build once, prepare local env + D1, start the production server (wrangler dev --local) in background.
# Usage: serve.sh [--rebuild] [--port 8001] | serve.sh --stop
set -euo pipefail
HARN="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HARN/../../../.." && pwd)"
RUN="$HARN/.run"; mkdir -p "$RUN"
PORT=8001; REBUILD=0
while [ $# -gt 0 ]; do case "$1" in
  --rebuild) REBUILD=1;; --port) PORT="$2"; shift;;
  --stop) for f in server proxy; do [ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null; rm -f "$RUN/$f.pid"; done
          lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true; echo stopped; exit 0;;
  *) echo "unknown arg $1" >&2; exit 64;; esac; shift; done
cd "$ROOT"

# 1. Local env (.env is gitignored by the repo); the admin password lives only in .run/credentials.json.
if [ ! -f .env ] || ! grep -q '^ADMIN_PASSWORD_HASH=pbkdf2' .env; then
  PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  HASH="$(npm run --silent auth:hash -- "$PASS")"
  {
    echo "ADMIN_EMAIL=admin@uniseller.local"
    echo "ADMIN_PASSWORD_HASH=$HASH"
    echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    echo "TRUSTED_IP_HEADER=none"
    echo "AI_PROVIDER=deepseek"
    echo "AI_API_KEY="
    echo "TELEGRAM_WORKER_URL=http://127.0.0.1:8790"
  } > .env
  printf '{"email":"admin@uniseller.local","password":"%s"}\n' "$PASS" > "$RUN/credentials.json"
  REBUILD=1
fi
[ -f "$RUN/credentials.json" ] || { echo "No $RUN/credentials.json for existing .env; delete .env to regenerate" >&2; exit 1; }

# 2. Build once (dist is stale when any source is newer than dist/server/wrangler.json).
if [ "$REBUILD" = 1 ] || [ ! -f dist/server/wrangler.json ] || \
   [ -n "$(find app components lib hooks .env -newer dist/server/wrangler.json -type f 2>/dev/null | head -1)" ]; then
  npm run build > "$RUN/build.log" 2>&1 || { echo "build failed, see $RUN/build.log" >&2; exit 1; }
fi
# wrangler reads secrets from .dev.vars/.env next to its config.
cp .env dist/server/.dev.vars

# 3. D1 migrations on local state, each once (marker per file).
WR="node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js"
mkdir -p .wrangler/state
for f in drizzle/*.sql; do
  m=".wrangler/state/.harness-migrated-$(basename "$f")"
  [ -f "$m" ] && continue
  $WR d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file "$f" >> "$RUN/migrate.log" 2>&1 \
    || grep -q 'already exists' "$RUN/migrate.log" || { echo "migration $f failed, see $RUN/migrate.log" >&2; exit 1; }
  touch "$m"
done

# 4. Start the server in background.
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null; then echo "port $PORT busy (already running?)"; exit 0; fi
nohup $WR dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 \
  --inspector-port 0 --port "$PORT" > "$RUN/server.log" 2>&1 &
echo $! > "$RUN/server.pid"
for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2>/dev/null && { echo "server up http://127.0.0.1:$PORT (log $RUN/server.log)"; exit 0; }; sleep 1; done
echo "server did not answer in 60s, see $RUN/server.log" >&2; exit 1
