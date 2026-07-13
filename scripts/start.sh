#!/bin/bash
set -e

echo "🚀 Starting Riviamigo development server..."
echo ""

# Source .env so DATABASE_URL, REDIS_URL, etc. are available for health checks
# and cargo run.  Do this early — before any tool availability checks — so any
# PATH overrides in .env are also picked up.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

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

# Check if docker is installed
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed. Install Docker Desktop from:"
  echo "   https://www.docker.com/products/docker-desktop"
  exit 1
fi

export COMPOSE_PROJECT_NAME="riviamigo"

# Ensure infrastructure is running
echo "📦 Starting infrastructure (TimescaleDB, Redis, Garage)..."
docker compose -f compose/docker-compose.dev.yml up -d timescaledb redis garage

# Wait for services to be healthy using Docker's own health status rather than
# a fixed sleep so the script proceeds as soon as the DB is ready instead of
# racing a timer.
echo "⏳ Waiting for services to be ready..."
docker compose -f compose/docker-compose.dev.yml wait timescaledb 2>/dev/null || \
  docker compose -f compose/docker-compose.dev.yml up --wait timescaledb redis 2>/dev/null || \
  until docker compose -f compose/docker-compose.dev.yml exec -T timescaledb pg_isready -U riviamigo -d riviamigo -q 2>/dev/null; do
    sleep 1
  done

# Build web app if needed
if [ ! -d "apps/web/dist" ]; then
  echo "📦 Web app not built. Building first..."
  pnpm turbo build
fi

# Start the API server
echo ""
echo "✅ Infrastructure is running"
echo "🚀 Starting API server (http://localhost:3001)..."
echo ""
cd apps/api
cargo run --release

