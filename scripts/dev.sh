#!/bin/bash
set -e

echo "🚀 Starting Riviamigo development servers..."
echo ""
echo "ℹ️  Make sure docker-compose is running:"
echo "   docker compose -f infra/docker-compose.yml up -d"
echo ""

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm is not installed. Install it with:"
  echo "   brew install pnpm"
  echo "   or visit https://pnpm.io/installation"
  exit 1
fi

# Start all dev servers using turbo
pnpm turbo dev

