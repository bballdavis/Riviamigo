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

# Check if docker is installed
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed. Install Docker Desktop from:"
  echo "   https://www.docker.com/products/docker-desktop"
  exit 1
fi

export COMPOSE_PROJECT_NAME="riviamigo"

# Ensure infrastructure is running
echo "📦 Starting infrastructure (TimescaleDB, Redis, Garage)..."
docker compose -f infra/docker-compose.yml up -d timescaledb redis garage

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 3

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

