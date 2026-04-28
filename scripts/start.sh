#!/bin/bash
set -e

echo "🚀 Starting Riviamigo production server..."

# Check if build exists
if [ ! -d "apps/web/dist" ]; then
  echo "⚠️  Web app not built. Building first..."
  ./scripts/build.sh
fi

# Start the API server
echo "Starting API server..."
cd apps/api
cargo run --release

