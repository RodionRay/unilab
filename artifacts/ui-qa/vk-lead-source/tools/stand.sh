#!/usr/bin/env bash
# Local UI-QA stand: production build served by wrangler dev (workerd + local D1) + optional
# Telegram worker (node only; /health is enough for telegramConnected=true).
#
#   stand.sh start [--rebuild] [--no-worker]   build if dist missing, migrate once, start, wait for health
#   stand.sh stop                              stop web + worker started by this script
#   stand.sh worker-start | worker-stop        toggle only the worker (telegramConnected true/false)
#   stand.sh status
#
# Env: UIQA_WEB_PORT (5191), UIQA_WORKER_PORT (8795), UIQA_RUN_DIR (pid + log dir).
# Secrets come from the gitignored <repo>/.env and are never printed.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${TOOLS_DIR}/../../../.." && pwd)"
WEB_PORT="${UIQA_WEB_PORT:-5191}"
WORKER_PORT="${UIQA_WORKER_PORT:-8795}"
RUN_DIR="${UIQA_RUN_DIR:-${TMPDIR:-/tmp}/unilab-uiqa-${WEB_PORT}}"
STATE_DIR="${REPO}/.wrangler/state"
WEB_PID="${RUN_DIR}/web.pid"
WORKER_PID="${RUN_DIR}/worker.pid"
MIGRATIONS=(0000_even_hydra.sql 0001_users_oauth.sql)

log() { printf '[stand] %s\n' "$*"; }
die() { printf '[stand] ERROR: %s\n' "$*" >&2; exit 1; }

load_env() {
  [[ -f "${REPO}/.env" ]] || die "missing ${REPO}/.env (see tools/README section in the report)"
  set -a
  # shellcheck disable=SC1091
  source "${REPO}/.env"
  set +a
  export APP_URL="http://127.0.0.1:${WEB_PORT}"
  export TELEGRAM_WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
  # Miniflare ignores process env unless told otherwise (see Dockerfile).
  export CLOUDFLARE_INCLUDE_PROCESS_ENV=true
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "${pid}" 2>/dev/null || true); do kill_tree "${child}"; done
  kill "${pid}" 2>/dev/null || true
}

stop_pidfile() {
  local file="$1" label="$2" pid
  if alive "${file}"; then
    pid="$(cat "${file}")"
    kill_tree "${pid}"
    for _ in $(seq 1 50); do kill -0 "${pid}" 2>/dev/null || break; sleep 0.1; done
    log "${label} stopped (pid ${pid})"
  fi
  rm -f "${file}"
}

wait_http() {
  local url="$1" label="$2" tries="${3:-90}"
  for _ in $(seq 1 "${tries}"); do
    if curl -fsS -o /dev/null --max-time 2 "${url}" 2>/dev/null; then log "${label} healthy: ${url}"; return 0; fi
    sleep 1
  done
  return 1
}

wrangler() {
  (cd "${REPO}" && node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js "$@")
}

build_if_needed() {
  local rebuild="$1"
  if [[ "${rebuild}" == "1" || ! -f "${REPO}/dist/server/wrangler.json" ]]; then
    log "building (npm run build) → ${RUN_DIR}/build.log"
    (cd "${REPO}" && npm run build >"${RUN_DIR}/build.log" 2>&1) || die "build failed, see ${RUN_DIR}/build.log"
  fi
}

migrate_once() {
  local file marker
  mkdir -p "${STATE_DIR}"
  for file in "${MIGRATIONS[@]}"; do
    marker="${STATE_DIR}/.uiqa-migrated-${file}"
    [[ -f "${marker}" ]] && continue
    log "applying migration ${file}"
    wrangler d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json \
      --file "drizzle/${file}" >>"${RUN_DIR}/migrate.log" 2>&1 || die "migration ${file} failed, see ${RUN_DIR}/migrate.log"
    touch "${marker}"
  done
}

start_worker() {
  if alive "${WORKER_PID}"; then log "worker already running (pid $(cat "${WORKER_PID}"))"; return 0; fi
  port_busy "${WORKER_PORT}" && die "port ${WORKER_PORT} busy (not ours)"
  # CRON_SECRET empty for the worker: auto-rescan stays off so seeded groups are not rescanned.
  (cd "${REPO}" && CRON_SECRET="" TG_WORKER_PORT="${WORKER_PORT}" \
    nohup node telegram-worker/src/server.mjs >"${RUN_DIR}/worker.log" 2>&1 </dev/null & echo $! >"${WORKER_PID}")
  wait_http "http://127.0.0.1:${WORKER_PORT}/health" "worker" 20 || die "worker not healthy, see ${RUN_DIR}/worker.log"
}

start_web() {
  if alive "${WEB_PID}"; then log "web already running (pid $(cat "${WEB_PID}"))"; return 0; fi
  port_busy "${WEB_PORT}" && die "port ${WEB_PORT} busy (not ours)"
  (cd "${REPO}" && nohup node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev \
    --config dist/server/wrangler.json --local --persist-to .wrangler/state \
    --ip 127.0.0.1 --port "${WEB_PORT}" --inspector-port 0 \
    >"${RUN_DIR}/web.log" 2>&1 </dev/null & echo $! >"${WEB_PID}")
  wait_http "http://127.0.0.1:${WEB_PORT}/api/health" "web" 120 || die "web not healthy, see ${RUN_DIR}/web.log"
}

cmd="${1:-start}"; shift || true
mkdir -p "${RUN_DIR}"
case "${cmd}" in
  start)
    rebuild=0; with_worker=1
    for arg in "$@"; do
      case "${arg}" in
        --rebuild) rebuild=1 ;;
        --no-worker) with_worker=0 ;;
        *) die "unknown flag ${arg}" ;;
      esac
    done
    load_env
    build_if_needed "${rebuild}"
    migrate_once
    [[ "${with_worker}" == "1" ]] && start_worker
    start_web
    log "logs: ${RUN_DIR}"
    ;;
  stop)
    stop_pidfile "${WEB_PID}" "web"
    stop_pidfile "${WORKER_PID}" "worker"
    ;;
  worker-start) load_env; start_worker ;;
  worker-stop) stop_pidfile "${WORKER_PID}" "worker" ;;
  status)
    alive "${WEB_PID}" && log "web pid $(cat "${WEB_PID}") port ${WEB_PORT}" || log "web down"
    alive "${WORKER_PID}" && log "worker pid $(cat "${WORKER_PID}") port ${WORKER_PORT}" || log "worker down"
    ;;
  *) die "usage: stand.sh start [--rebuild] [--no-worker] | stop | worker-start | worker-stop | status" ;;
esac
