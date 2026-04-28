#!/bin/sh
# Starts Garage and initializes the cluster on first boot.
# Fixed dev credentials so env files stay static across restarts.
set -e

DEV_KEY_ID="GKdeadbeef0000000000000000000000"
DEV_SECRET="deadbeef0000000000000000000000000000000000000000000000000000cafe"
DEV_BUCKET="riviamigo"
INIT_MARKER="/var/lib/garage/meta/.dev_initialized"

garage -c /etc/garage.toml server &
GARAGE_PID=$!

echo "Waiting for Garage RPC to be ready..."
until garage -c /etc/garage.toml status >/dev/null 2>&1; do
  sleep 1
done

if [ ! -f "$INIT_MARKER" ]; then
  echo "First boot — initializing Garage cluster..."

  NODE_ID=$(garage -c /etc/garage.toml node id | awk '{print $1}')
  garage -c /etc/garage.toml layout assign "$NODE_ID" -z dc1 -c 1G
  garage -c /etc/garage.toml layout apply --version 1

  garage -c /etc/garage.toml key import -n dev-key "$DEV_KEY_ID" "$DEV_SECRET"
  garage -c /etc/garage.toml bucket create "$DEV_BUCKET"
  garage -c /etc/garage.toml bucket allow --read --write --owner "$DEV_BUCKET" --key "$DEV_KEY_ID"

  touch "$INIT_MARKER"
  echo "Garage ready. S3 endpoint: http://localhost:3900, region: garage"
fi

wait $GARAGE_PID
