#!/bin/sh
set -eu

mkdir -p /backups /data/cache/riviamigo/vehicle-images
chown -R 1001:1001 /backups /data/cache

if [ ! -s /backups/.restore-agent-key ]; then
  umask 077
  dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 > /backups/.restore-agent-key
fi
chown 1001:1001 /backups/.restore-agent-key

bind_address=${RIVIAMIGO_BIND_ADDRESS:-127.0.0.1}
if [ "$bind_address" != "127.0.0.1" ] && [ "$bind_address" != "::1" ] \
  && [ "${ALLOW_PUBLIC_ORIGIN_BIND:-false}" != "true" ]; then
  echo "Refusing non-loopback Riviamigo origin binding without ALLOW_PUBLIC_ORIGIN_BIND=true" >&2
  exit 1
fi

# This one-shot service is the only root process. The long-lived application,
# restore agent, and nginx supervisor run as UID/GID 1001.
