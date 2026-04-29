#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v node >/dev/null 2>&1; then
  node ./scripts/dev.mjs "$@"
elif [[ -x "/c/Program Files/nodejs/node.exe" ]]; then
  "/c/Program Files/nodejs/node.exe" ./scripts/dev.mjs "$@"
elif [[ -x "/c/Progra~1/nodejs/node.exe" ]]; then
  "/c/Progra~1/nodejs/node.exe" ./scripts/dev.mjs "$@"
elif [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
  "/mnt/c/Program Files/nodejs/node.exe" ./scripts/dev.mjs "$@"
elif [[ -x "/mnt/c/Progra~1/nodejs/node.exe" ]]; then
  "/mnt/c/Progra~1/nodejs/node.exe" ./scripts/dev.mjs "$@"
else
  echo "node is required to run the Riviamigo dev stack."
  exit 1
fi
