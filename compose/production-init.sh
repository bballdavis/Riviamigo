#!/bin/sh
set -eu

mkdir -p /backups /cache/riviamigo/vehicle-images
chown -R 1001:1001 /backups /cache

exec setpriv --reuid=1001 --regid=1001 --clear-groups /app/production-services.sh
