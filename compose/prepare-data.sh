#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
configured_data_dir=${RIVIAMIGO_DATA_DIR:-../data}

case "$configured_data_dir" in
  /*) data_dir=$configured_data_dir ;;
  *) data_dir=$script_dir/$configured_data_dir ;;
esac

mkdir -p \
  "$data_dir/db" \
  "$data_dir/redis" \
  "$data_dir/backups" \
  "$data_dir/cache"

for directory in \
  "$data_dir/db" \
  "$data_dir/redis" \
  "$data_dir/backups" \
  "$data_dir/cache"
do
  if [ ! -d "$directory" ]; then
    echo "Riviamigo data directory was not created: $directory" >&2
    exit 1
  fi
  if [ ! -w "$directory" ]; then
    echo "Riviamigo data directory is not writable by this user: $directory" >&2
    exit 1
  fi
  printf 'Prepared %s\n' "$directory"
done
