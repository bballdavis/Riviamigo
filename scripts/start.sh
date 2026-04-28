#!/bin/bash
set -e

echo "🚀 Starting Riviamigo production server..."
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm is not installed. Install it with:"
  echo "   brew install pnpm"
  exit 1
fi

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
  echo "❌ Rust is not installed. Install it with:"
  echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi

# Check if build exists
if [ ! -d "apps/web/dist" ]; then
  echo "⚠️  Web app not built. Building first..."
  pnpm turbo build
fi

# Start the API server
echo ""
echo "Starting API server..."
cd apps/api
cargo run --release

