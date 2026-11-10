#!/usr/bin/env bash
# Tiny process helper for local runs without Docker: ./scripts/svc.sh start|stop|restart <name> [cmd...]
# Keeps PID files and logs under .data/ so services can be restarted reliably.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.data"
action="$1"; name="$2"; shift 2 || true
pidfile="$ROOT/.data/$name.pid"
logfile="$ROOT/.data/$name.log"

stop() {
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    rm -f "$pidfile"
  fi
}

start() {
  nohup "$@" >"$logfile" 2>&1 &
  echo $! >"$pidfile"
  echo "$name started (pid $(cat "$pidfile")), logs: $logfile"
}

case "$action" in
  start) start "$@" ;;
  stop) stop ;;
  restart) stop; start "$@" ;;
  *) echo "usage: $0 start|stop|restart <name> [cmd...]"; exit 1 ;;
esac
