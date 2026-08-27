#!/bin/sh
set -eu

mkdir -p /backups /data/cache/riviamigo/vehicle-images
chown -R 1001:1001 /backups /data/cache

# DSM shared-folder ACLs can override container-side ownership. Probe the
# actual application identity instead of assuming chown was sufficient.
if ! command -v setpriv >/dev/null 2>&1; then
  echo "Riviamigo init cannot verify UID/GID 1001 access: setpriv is missing from the image" >&2
  exit 1
fi
for probe_dir in /backups /data/cache/riviamigo/vehicle-images; do
  probe_file="$probe_dir/.riviamigo-acl-probe"
  if ! setpriv --reuid=1001 --regid=1001 --clear-groups sh -c \
    "umask 077; printf '%s\\n' acl-probe > '$probe_file' && rm -f '$probe_file'"; then
    echo "Riviamigo init cannot write/delete $probe_dir as UID/GID 1001." >&2
    echo "In DSM, grant the Container Manager project service Owner=Read/Write on the shared folder and retry; do not weaken container security." >&2
    exit 1
  fi
done

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
