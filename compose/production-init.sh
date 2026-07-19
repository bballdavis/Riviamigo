#!/bin/sh
set -eu

mkdir -p /backups /data/cache/riviamigo/vehicle-images
chown -R 1001:1001 /backups /data/cache

# Keep the supervisor and nginx master privileged enough to open their log
# streams. production-services.sh drops only the API process to riviamigo;
# nginx drops its workers using the `user` directive in nginx.conf.
exec /app/production-services.sh
