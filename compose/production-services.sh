#!/bin/bash
set -u

api_pid=
agent_pid=
nginx_pid=

start_api() {
  /usr/bin/setpriv --reuid=1001 --regid=1001 --clear-groups /app/riviamigo-api \
    2> >(normalize_child_errors api) &
  api_pid=$!
  printf '%s\n' "$api_pid" > /tmp/riviamigo-api.pid
}

normalize_child_errors() {
  source=$1
  while IFS= read -r line; do
    level=ERROR
    if [ "$source" = nginx ]; then
      case "$line" in
        *"[warn]"*) level=WARN ;;
        *"[notice]"*|*"[info]"*|*"[debug]"*) level=INFO ;;
      esac

      if [[ "$line" =~ ^[^\[]+\[[^]]+\][^:]*:[[:space:]]?(.*)$ ]]; then
        line="${BASH_REMATCH[1]}"
      fi
    fi
    line=${line//\\/\\\\}
    line=${line//\"/\\\"}
    printf '[riviamigo][%s] source=%s message="%s"\n' "$level" "$source" "$line" >&2
  done
}

shutdown() {
  trap - TERM INT
  [ -n "$api_pid" ] && kill -TERM "$api_pid" 2>/dev/null || true
  [ -n "$agent_pid" ] && kill -TERM "$agent_pid" 2>/dev/null || true
  [ -n "$nginx_pid" ] && kill -TERM "$nginx_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap 'shutdown; exit 0' TERM INT

/app/riviamigo-restore-agent 2> >(normalize_child_errors restore-agent) &
agent_pid=$!
nginx -g 'daemon off;' 2> >(normalize_child_errors nginx) &
nginx_pid=$!
start_api

while true; do
  if ! kill -0 "$nginx_pid" 2>/dev/null || ! kill -0 "$agent_pid" 2>/dev/null; then
    shutdown
    exit 1
  fi

  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
    api_status=$?
    if [ -f /tmp/riviamigo-restore-in-progress ]; then
      while [ -f /tmp/riviamigo-restore-in-progress ]; do
        if ! kill -0 "$agent_pid" 2>/dev/null; then
          shutdown
          exit 1
        fi
        sleep 1
      done
      start_api
    else
      shutdown
      exit "$api_status"
    fi
  fi
  sleep 0.2
done
