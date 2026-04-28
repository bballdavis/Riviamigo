#!/bin/bash
set -e

echo "🔨 Building Riviamigo..."
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm is not installed. Install it with:"
  echo "   brew install pnpm"
  echo "   or visit https://pnpm.io/installation"
  exit 1
fi

# Build all packages using turbo
pnpm turbo build

echo ""
echo "✅ Build complete!"
