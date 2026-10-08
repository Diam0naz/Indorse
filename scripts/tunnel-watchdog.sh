#!/usr/bin/env bash
# scripts/tunnel-watchdog.sh — keeps the device↔host tunnel pointed at what is alive
#
# Two things move under this dev setup: the adb reverse tunnels (they die on
# every USB re-enumeration — three+ times in one session) and the Metro port
# (8082 in the .env.local device loop, 8081 from the supervised `npm run dev`).
# Every cycle this script:
#
#   1. health-checks the API (GET /api/directory) and scans the candidate
#      Metro ports for one that answers — "finds the working port";
#   2. re-adds whichever `adb reverse` lines are missing or point at a dead
#      port — "connects directly", within one interval of a drop;
#   3. probes the four AI routes for liveness and logs TRANSITIONS only
#      (any HTTP answer, even a 405, means the route is up — provider-level
#      outages are absorbed server-side by api/_lib/balance.ts);
#   4. self-heals: restarts the :8082 Metro when the preferred port has been
#      down for three straight cycles, and `api:dev` when the API is dead AND
#      no serve-api process exists (so it never races a supervisor that is
#      about to restart it itself). The supervised 8081 instance is never
#      touched.
#
# Only state CHANGES are printed, so the log stays quiet while healthy.
#   Run: npm run dev:tunnel        (or: bash scripts/tunnel-watchdog.sh)
#   Env: TUNNEL_WATCH_INTERVAL     seconds between cycles (default 4)

set -u
cd "$(dirname "$0")/.."

API_PORT=3000
METRO_PREFERRED=8082
METRO_PORTS=(8082 8081) # preferred first
AI_ROUTES=(classify classify-gemini grade assistant)
INTERVAL="${TUNNEL_WATCH_INTERVAL:-4}"
API_DEAD_CYCLES=0
METRO_DEAD_CYCLES=0
last_state=""

log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }

# curl always prints the -w string (000 on failure) — swallow its exit code.
http_code() { curl -s -m 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }

while true; do
  state=""
  if ! adb get-state >/dev/null 2>&1; then
    state="device:offline"
  else
    # ── 1. API liveness ────────────────────────────────────────────────
    api_code=$(http_code "http://127.0.0.1:${API_PORT}/api/directory")
    if [ "$api_code" = "200" ]; then
      api_up=yes
      API_DEAD_CYCLES=0
    else
      api_up=no
      API_DEAD_CYCLES=$((API_DEAD_CYCLES + 1))
      if [ "$API_DEAD_CYCLES" -ge 3 ] && ! pgrep -f 'serve-api' >/dev/null 2>&1; then
        log "api: dead for ${API_DEAD_CYCLES} cycles and no serve-api process — restarting api:dev"
        nohup npm run api:dev > /tmp/opencode/api-dev.log 2>&1 &
        API_DEAD_CYCLES=0
      fi
    fi

    # ── 2. find the working Metro port ─────────────────────────────────
    metro=""
    for port in "${METRO_PORTS[@]}"; do
      if [ "$(curl -s -m 1 "http://127.0.0.1:${port}/status" 2>/dev/null)" = "packager-status:running" ]; then
        metro="$port"
        break
      fi
    done

    # ── 3. repair the reverse tunnels ──────────────────────────────────
    if [ "$api_up" = yes ]; then
      adb reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null 2>&1
    fi
    if [ -n "$metro" ]; then
      adb reverse tcp:8081 "tcp:${metro}" >/dev/null 2>&1
    fi

    # Self-heal the preferred Metro when it (not just the fallback) is down.
    if [ "$metro" = "$METRO_PREFERRED" ]; then
      METRO_DEAD_CYCLES=0
    else
      METRO_DEAD_CYCLES=$((METRO_DEAD_CYCLES + 1))
      if [ "$METRO_DEAD_CYCLES" -ge 3 ]; then
        log "metro: ${METRO_PREFERRED} down for ${METRO_DEAD_CYCLES} cycles — restarting"
        nohup npx expo start --port "$METRO_PREFERRED" --dev-client --clear --reset-cache \
          > "/tmp/opencode/metro-${METRO_PREFERRED}.log" 2>&1 &
        METRO_DEAD_CYCLES=0
      fi
    fi

    # ── 4. AI route liveness (transition logging only) ─────────────────
    ai_state=""
    for route in "${AI_ROUTES[@]}"; do
      code=$(http_code "http://127.0.0.1:${API_PORT}/api/${route}")
      if [ "$code" = "000" ]; then ai_state="${ai_state}${route}:down "; else ai_state="${ai_state}${route}:up "; fi
    done

    state="api:${api_up} metro:${metro:-down} ${ai_state}"
  fi

  if [ "$state" != "$last_state" ]; then
    log "tunnel: $state"
    last_state="$state"
  fi
  sleep "$INTERVAL"
done
