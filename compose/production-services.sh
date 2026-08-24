#!/bin/bash
set -u

api_pid=
agent_pid=
nginx_pid=

start_api() {
  /app/riviamigo-api 2> >(normalize_child_errors api) &
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

prepare_storage() {
  mkdir -p /backups /data/cache/riviamigo/vehicle-images

  for directory in /backups /data/cache; do
    if [ ! -w "$directory" ]; then
      echo "Riviamigo cannot write to $directory as UID $(id -u)." >&2
      echo "For a bind mount, grant the container user write access to the host folder." >&2
      exit 1
    fi
    if ! temporary_probe=$(mktemp "$directory/.riviamigo-write-test.XXXXXX" 2>/dev/null); then
      echo "Riviamigo cannot create a writable storage probe in $directory." >&2
      exit 1
    fi
    printf '%s\n' "storage probe" > "$temporary_probe"
    sync -f "$temporary_probe" 2>/dev/null || true
    rm -f "$temporary_probe"
  done

  if [ ! -s /backups/.restore-agent-key ]; then
    umask 077
    temporary_key=/backups/.restore-agent-key.tmp.$$
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 > "$temporary_key"
    mv "$temporary_key" /backups/.restore-agent-key
  fi
}

trap 'shutdown; exit 0' TERM INT

prepare_storage
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
