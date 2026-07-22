#!/bin/sh
set -eu

if curl -fsS http://localhost:8080/health >/dev/null; then
  exit 0
fi

if [ -f /tmp/riviamigo-restore-in-progress ]; then
  curl -fsS http://127.0.0.1:3002/health >/dev/null
  exit $?
fi

exit 1
