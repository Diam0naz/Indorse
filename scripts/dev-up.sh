#!/usr/bin/env bash
#
# scripts/dev-up.sh — from a dead shell to a running app, in one command.
#
#   npm run up                  preflight → API → Metro → adb reverse → verify
#   npm run up -- --check       …and start only if all four quality gates pass
#   npm run up -- --port 8082   Metro on a specific port
#   npm run up -- --keep-cache  skip the Metro cache clear (faster restart)
#   npm run up -- --help
#
# This is README → Device dev loop, executed instead of retyped:
#
#   npm run api:dev                     http://localhost:3000
#   npx expo start --dev-client --port  http://localhost:8081
#   adb reverse tcp:8081 tcp:8081       Metro → device
#   adb reverse tcp:3000 tcp:3000       API   → device
#   POST /api/siws/nonce → 200          the documented recovery check
#
# The last line is the important one. The README says to verify it *before*
# debugging anything deeper, because a dead background shell and a broken app
# look identical from the device — so this script proves the path end to end
# and reports which half is at fault if it does not hold.
#
# Reuse matters as much as start-up: anything already healthy is left alone,
# and only processes this script started are stopped on exit. adb reverse
# lines are put back exactly as they were found — a mapping belonging to a
# service still running is never removed.
#
# Deliberately narrow supervision: hold the processes, stop them cleanly.
# For self-healing — re-adding a dropped `adb reverse` after a replug,
# restarting a dead Metro — use `npm run dev:tunnel`
# (scripts/tunnel-watchdog.sh).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── output ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' B=$'\033[1m' D=$'\033[2m' X=$'\033[0m'
else
  G='' R='' Y='' B='' D='' X=''
fi
info() { printf '%s·%s %s\n' "$B" "$X" "$*"; }
ok()   { printf '%s✓%s %s\n' "$G" "$X" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$X" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$R" "$X" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$X"; }

usage() {
  # The whole header comment, up to the line before `set -euo pipefail` —
  # kept dynamic so editing the header can't silently truncate --help.
  sed -n '3,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '/^set -euo/d; s/^# \{0,1\}//'
}

# ── arguments �────────────────────────────────────────────────────────────
RUN_GATES=0
CLEAR_CACHE=1
METRO_PORT=""
EXPLICIT_PORT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --check | --gates) RUN_GATES=1 ;;
    --keep-cache) CLEAR_CACHE=0 ;;
    --clear) CLEAR_CACHE=1 ;;
    --port)
      shift
      [ $# -gt 0 ] || die "--port needs a value"
      METRO_PORT="$1" EXPLICIT_PORT=1
      ;;
    --port=*) METRO_PORT="${1#*=}" EXPLICIT_PORT=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# NB: no `a && b && c` chains for control flow — under `set -e` a chain whose
# first test fails is a failing statement and would abort the script outright.
if [ "$EXPLICIT_PORT" = 1 ]; then
  case "$METRO_PORT" in
    '' | *[!0-9]*) die "--port needs a plain number, got: '$METRO_PORT'" ;;
  esac
fi

API_PORT="${PORT:-3000}"
DEVICE_METRO_PORT=8081 # the dev client always dials localhost:8081

# ── process state ────────────────────────────────────────────────────────
API_PID=""
METRO_PID=""

# ── shutdown ─────────────────────────────────────────────────────────────
# Kill a whole process group: `npx`/`npm run` spawn children, and signalling
# only the parent would leave the port bound — the exact "restart fails"
# annoyance this script exists to avoid.
stop_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local i
  for i in {1..10}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.3
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  printf '\n'
  if [ -n "$METRO_PID" ]; then
    info "stopping Metro (pid $METRO_PID)"
    stop_pid "$METRO_PID"
    reverse_restore "$DEVICE_METRO_PORT"
  fi
  if [ -n "$API_PID" ]; then
    info "stopping API (pid $API_PID)"
    stop_pid "$API_PID"
    reverse_restore "$API_PORT"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# ── probes ───────────────────────────────────────────────────────────────
# The HTTP status, or 000 when nothing answered.
http_code() { # METHOD URL [timeout]
  local out
  out="$(curl -s -o /dev/null -m "${3:-4}" -w '%{http_code}' -X "$1" "$2" 2>/dev/null)" || true
  printf '%s' "${out:-000}"
}

api_healthy() {
  [ "$(http_code POST "http://127.0.0.1:$API_PORT/api/siws/nonce" 3)" = "200" ]
}

metro_status() {
  curl -s -m 2 "http://127.0.0.1:$1/status" 2>/dev/null || true
}

metro_up() {
  [ "$(metro_status "$1")" = "packager-status:running" ]
}

# bash's /dev/tcp — instant, and it does not depend on lsof/ss being present.
port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

port_listener() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$1" 2>/dev/null | tail -n +2 | head -n1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -n -P 2>/dev/null | tail -n +2 | head -n1
  fi
}

# ── adb reverse bookkeeping ──────────────────────────────────────────────
ADB_SERIAL=""
ADB_REVERSE_LIST=""
# Reverse lines we change, remembered with what was there before so shutdown
# can put the device back exactly as it found it. Indexed in parallel.
touched_device=() # e.g. tcp:8081
touched_prev=()   # the host port it pointed at before us, "" if none existed

adb_available() { [ -n "$ADB_SERIAL" ]; }

# What a device port pointed at before we touched it, if anything. The list
# prints a leading transport field ("UsbFfs tcp:8081 tcp:8082"), so match on
# the last two fields rather than anchoring at the start of the line.
reverse_prev() { # device_port → prints the previous host port, or nothing
  printf '%s\n' "$ADB_REVERSE_LIST" | awk -v d="tcp:$1" '$(NF - 1) == d { print $NF; exit }'
}

# Adds a mapping unless it already reads exactly as we want it. When it does
# change, both the old and new values are recorded.
reverse_add() { # device_port host_port
  local d="tcp:$1" h="tcp:$2" prev
  prev="$(reverse_prev "$1")"
  if [ "$prev" = "$h" ]; then
    info "adb reverse $d → $h already present"
    return 0
  fi
  if adb -s "$ADB_SERIAL" reverse "$d" "$h" >/dev/null 2>&1; then
    touched_device+=("$d")
    touched_prev+=("$prev")
    if [ -n "$prev" ]; then
      ok "adb reverse $d → $h (was $prev)"
    else
      ok "adb reverse $d → $h"
    fi
  else
    warn "adb reverse $d → $h failed — the device cannot reach this host"
  fi
}

# Puts one device port back the way it was: the previous mapping if there was
# one, nothing if there was not. Called only for services this script stops,
# so a reverse belonging to something still running is left alone.
reverse_restore() { # device_port
  if [ "${#touched_device[@]}" -eq 0 ]; then return 0; fi
  local i prev
  for i in "${!touched_device[@]}"; do
    if [ "${touched_device[$i]}" = "tcp:$1" ]; then
      prev="${touched_prev[$i]}"
      if [ -n "$prev" ]; then
        adb -s "$ADB_SERIAL" reverse "tcp:$1" "$prev" >/dev/null 2>&1 || true
      else
        adb -s "$ADB_SERIAL" reverse --remove "tcp:$1" >/dev/null 2>&1 || true
      fi
      return 0
    fi
  done
}

# ── preflight ────────────────────────────────────────────────────────────
step "preflight"

command -v node >/dev/null 2>&1 || die "node not found on PATH"
command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
command -v curl >/dev/null 2>&1 || die "curl not found on PATH (health checks need it)"

if [ -d node_modules ]; then
  ok "dependencies present"
else
  info "node_modules missing — running npm install"
  npm install
  ok "dependencies installed"
fi

if [ -f .env ]; then
  ok ".env present"
else
  warn ".env not found — the AI routes will have no provider keys."
  warn "  create one:  cp .env.example .env   (startup continues without it)"
fi

if command -v adb >/dev/null 2>&1; then
  adb_devices="$(adb devices 2>/dev/null | awk '$2 == "device" { print $1 }' || true)"
  device_count="$(printf '%s' "$adb_devices" | grep -c . || true)"
  if [ "${device_count:-0}" -eq 1 ]; then
    ADB_SERIAL="$(printf '%s' "$adb_devices" | head -n1)"
    ADB_REVERSE_LIST="$(adb -s "$ADB_SERIAL" reverse --list 2>/dev/null || true)"
    ok "adb device $ADB_SERIAL"
  elif [ "${device_count:-0}" -gt 1 ]; then
    warn "multiple adb devices attached — skipping adb reverse (set ANDROID_SERIAL to pick one)"
  else
    warn "no adb device attached — skipping adb reverse (launch one, or install the debug APK)"
  fi
else
  warn "adb not found on PATH — skipping adb reverse"
fi

# ── ports ────────────────────────────────────────────────────────────────
# Reuse a healthy Metro wherever it already answers (8081 is the README's
# default, but a port survives as "whatever was free when it started"). Only
# an explicit --port pins it.
if [ "$EXPLICIT_PORT" != 1 ]; then
  METRO_PORT=""
  for p in {8081..8090}; do
    if metro_up "$p"; then
      METRO_PORT="$p"
      break
    fi
  done
  METRO_PORT="${METRO_PORT:-8081}"
fi

REUSE_API=0
REUSE_METRO=0

if api_healthy; then
  REUSE_API=1
  ok "API already healthy on :$API_PORT — reusing it"
elif port_open "$API_PORT"; then
  die "port $API_PORT is in use but is not answering POST /api/siws/nonce
  listener: $(port_listener "$API_PORT")
  free the port, or rerun with PORT=<other>"
fi

if metro_up "$METRO_PORT"; then
  REUSE_METRO=1
  ok "Metro already running on :$METRO_PORT — reusing it"
elif port_open "$METRO_PORT"; then
  die "port $METRO_PORT is in use but is not Metro
  listener: $(port_listener "$METRO_PORT")
  rerun with --port <free port>"
fi

# ── quality gates (opt-in) ───────────────────────────────────────────────
gate() { # name command...
  local name="$1" log
  shift
  log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    ok "$name"
    rm -f "$log"
  else
    printf '%s✗%s gate failed: %s\n' "$R" "$X" "$name" >&2
    cat "$log" >&2
    rm -f "$log"
    exit 1
  fi
}

if [ "$RUN_GATES" = 1 ]; then
  step "quality gates"
  gate "tsc" npx tsc --noEmit
  gate "lint" npx expo lint
  gate "format" npx prettier --check .
  gate "tests" npx vitest run
  ok "all four gates green"
else
  info "gates skipped — pass --check to run tsc + lint + format + tests first"
fi

# ── start ────────────────────────────────────────────────────────────────
step "starting"

# Job control on: each child gets its own process group, so cleanup can kill
# the whole tree (npx → node) rather than orphaning whatever holds the port.
set -m

if [ "$REUSE_API" != 1 ]; then
  npm run api:dev &
  API_PID=$!
  info "API launched (pid $API_PID) → http://localhost:$API_PORT"
fi

info "waiting for the API …"
deadline=$((SECONDS + 30))
while :; do
  if api_healthy; then break; fi
  if [ -n "$API_PID" ] && ! kill -0 "$API_PID" 2>/dev/null; then
    die "the API exited before it answered — see its output above"
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    die "no answer from POST /api/siws/nonce on :$API_PORT after 30s"
  fi
  sleep 0.3
done
ok "API healthy on :$API_PORT"

EXPO_ARGS=(expo start --dev-client --port "$METRO_PORT")
if [ "$CLEAR_CACHE" = 1 ]; then
  EXPO_ARGS+=(--clear --reset-cache)
fi

if [ "$REUSE_METRO" != 1 ]; then
  npx "${EXPO_ARGS[@]}" &
  METRO_PID=$!
  info "Metro launched (pid $METRO_PID) → http://localhost:$METRO_PORT"
fi

info "waiting for Metro …"
deadline=$((SECONDS + 90))
while :; do
  if metro_up "$METRO_PORT"; then break; fi
  if [ -n "$METRO_PID" ] && ! kill -0 "$METRO_PID" 2>/dev/null; then
    die "Metro exited before it answered — see its output above"
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    die "Metro did not answer on :$METRO_PORT after 90s"
  fi
  sleep 0.5
done
ok "Metro healthy on :$METRO_PORT"

set +m

# ── device wiring ────────────────────────────────────────────────────────
step "device"
if adb_available; then
  reverse_add "$DEVICE_METRO_PORT" "$METRO_PORT"
  reverse_add "$API_PORT" "$API_PORT"
else
  warn "no device wired — adb is unavailable or nothing is attached"
fi

# ── verify ───────────────────────────────────────────────────────────────
step "verify"
code="$(http_code POST "http://127.0.0.1:$API_PORT/api/siws/nonce" 5)"
if [ "$code" = "200" ]; then
  ok "POST /api/siws/nonce → 200"
else
  die "POST /api/siws/nonce → $code
  The README's recovery check failed. Fix this before debugging anything
  deeper — a dead background shell looks exactly like a broken app."
fi

api_state="pid $API_PID"
metro_state="pid $METRO_PID"
if [ "$REUSE_API" = 1 ]; then api_state="already running (not ours to stop)"; fi
if [ "$REUSE_METRO" = 1 ]; then metro_state="already running (not ours to stop)"; fi

printf '\n%sready%s\n' "$B" "$X"
printf '  %-7s http://localhost:%-5s  %s\n' "API" "$API_PORT" "$api_state"
printf '  %-7s http://localhost:%-5s  %s\n' "Metro" "$METRO_PORT" "$metro_state"
if adb_available; then
  printf '  %-7s %s\n' "adb" "$ADB_SERIAL (reversed :$DEVICE_METRO_PORT → host :$METRO_PORT, :$API_PORT)"
else
  printf '  %-7s %s\n' "adb" "no device — reverse lines skipped"
fi
printf '\n  %sCtrl-C stops what this script started.%s\n' "$D" "$X"
if [ "$REUSE_API" = 1 ] || [ "$REUSE_METRO" = 1 ]; then
  printf '  %sIt does not touch the services it found running.%s\n' "$D" "$X"
fi
printf '\n'

# ── supervise ────────────────────────────────────────────────────────────
while :; do
  if [ -n "$API_PID" ] && ! kill -0 "$API_PID" 2>/dev/null; then
    die "the API (pid $API_PID) exited — the app will not authenticate until it is back"
  fi
  if [ -n "$METRO_PID" ] && ! kill -0 "$METRO_PID" 2>/dev/null; then
    die "Metro (pid $METRO_PID) exited — reload the app or rerun this script"
  fi
  sleep 2
done
