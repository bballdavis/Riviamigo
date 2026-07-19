#!/bin/bash
set -u

api_pid=
nginx_pid=

shutdown() {
  trap - TERM INT
  [ -n "$api_pid" ] && kill -TERM "$api_pid" 2>/dev/null || true
  [ -n "$nginx_pid" ] && kill -TERM "$nginx_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap 'shutdown; exit 0' TERM INT

/usr/bin/setpriv --reuid=1001 --regid=1001 --clear-groups /app/riviamigo-api &
api_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!

wait -n "$api_pid" "$nginx_pid"
status=$?
shutdown
exit "$status"
