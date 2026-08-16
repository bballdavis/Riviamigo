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

printf 'Prepared Riviamigo data directories under %s\n' "$data_dir"
