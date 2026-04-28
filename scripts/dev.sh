#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_PROJECT_NAME="riviamigo"
export COMPOSE_PROJECT_NAME
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
API_DIR="$ROOT_DIR/apps/api"
API_HEALTH_URL="http://localhost:3001/health"
WEB_URL="http://localhost:5173"

cleanup() {
  if [[ "${WEB_MODE:-}" == "managed" ]] && [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi

  if [[ "${API_MODE:-}" == "local" ]] && [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "🚀 Starting Riviamigo development stack..."
echo ""

# Check required tools.
for tool in pnpm docker curl; do
  if ! command -v "$tool" &> /dev/null; then
    case "$tool" in
      pnpm)
        echo "❌ pnpm is not installed. Install it with:"
        echo "   brew install pnpm"
        echo "   or visit https://pnpm.io/installation"
        ;;
      docker)
        echo "❌ Docker is not installed. Install Docker Desktop from:"
        echo "   https://www.docker.com/products/docker-desktop"
        ;;
      curl)
        echo "❌ curl is required to verify API readiness. Install it and retry ./scripts/dev.sh."
        ;;
    esac
    exit 1
  fi
done

ensure_docker_ready() {
  docker info >/dev/null 2>&1 &
  docker_info_pid=$!
  elapsed=0
  timeout_seconds=10

  while kill -0 "$docker_info_pid" 2>/dev/null; do
    if [[ $elapsed -ge $timeout_seconds ]]; then
      kill "$docker_info_pid" 2>/dev/null || true
      wait "$docker_info_pid" >/dev/null 2>&1 || true
      echo "❌ Docker Desktop is not responding. Start Docker before running ./scripts/dev.sh."
      exit 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  if ! wait "$docker_info_pid" >/dev/null 2>&1; then
    echo "❌ Docker Desktop is not responding. Start Docker before running ./scripts/dev.sh."
    exit 1
  fi
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  "$@" &
  local command_pid=$!
  local elapsed=0

  while kill -0 "$command_pid" 2>/dev/null; do
    if [[ $elapsed -ge $timeout_seconds ]]; then
      kill "$command_pid" 2>/dev/null || true
      wait "$command_pid" >/dev/null 2>&1 || true
      return 124
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  wait "$command_pid"
}

api_container_id() {
  docker compose -f "$COMPOSE_FILE" ps -q api 2>/dev/null || true
}

api_container_status() {
  local container_id
  container_id="$(api_container_id)"

  if [[ -z "$container_id" ]]; then
    return 1
  fi

  docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true
}

print_api_logs() {
  docker compose -f "$COMPOSE_FILE" logs --tail=200 api 2>/dev/null || true
}

wait_for_api_ready() {
  local timeout_seconds="$1"
  local elapsed=0

  until curl -fsS --max-time 2 "$API_HEALTH_URL" >/dev/null 2>&1; do
    if [[ "$API_MODE" == "local" ]]; then
      if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "❌ API dev server exited before becoming ready."
        return 1
      fi
    else
      local container_status
      container_status="$(api_container_status || true)"
      if [[ "$container_status" == "exited" || "$container_status" == "dead" ]]; then
        echo "❌ API container exited before becoming ready."
        print_api_logs
        return 1
      fi
    fi

    if [[ $elapsed -ge $timeout_seconds ]]; then
      echo "❌ Timed out waiting for the API health endpoint at $API_HEALTH_URL."
      if [[ "$API_MODE" == "docker" ]]; then
        print_api_logs
      fi
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done
}

wait_for_web_ready() {
  local timeout_seconds="$1"
  local elapsed=0

  until curl -fsS --max-time 2 "$WEB_URL" >/dev/null 2>&1; do
    if [[ "${WEB_MODE:-managed}" == "managed" ]] && ! kill -0 "$WEB_PID" 2>/dev/null; then
      echo "❌ Web dev server exited before becoming ready."
      return 1
    fi

    if [[ $elapsed -ge $timeout_seconds ]]; then
      echo "❌ Timed out waiting for the web dev server at $WEB_URL."
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done
}

ensure_docker_ready

echo "📦 Starting infrastructure (TimescaleDB, Redis, Garage)..."
if run_with_timeout 120 docker compose -f "$COMPOSE_FILE" up -d timescaledb redis garage; then
  :
else
  compose_status=$?
  if [[ $compose_status -eq 124 ]]; then
    echo "❌ Docker Compose did not start the infrastructure within 120 seconds."
  else
    echo "❌ Docker Compose failed to start the infrastructure."
  fi
  echo "   Check Docker Desktop, then retry ./scripts/dev.sh."
  exit 1
fi

echo "⏳ Waiting for TimescaleDB to accept connections..."
ready_timeout=120
elapsed=0
until docker compose -f "$COMPOSE_FILE" exec -T timescaledb pg_isready -U riviamigo >/dev/null 2>&1; do
  if [[ $elapsed -ge $ready_timeout ]]; then
    echo "❌ Timed out waiting for TimescaleDB to become ready."
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

echo ""
echo "✅ Infrastructure is running"
echo "   • TimescaleDB: postgresql://localhost:5432"
echo "   • Redis: redis://localhost:6379"
echo "   • S3 (Garage): http://localhost:3900"
echo ""
echo "🏃 Starting local dev servers..."
echo "   • API:  http://localhost:3001"
echo "   • Web:  http://localhost:5173"
echo ""

API_MODE="docker"
if command -v cargo &> /dev/null; then
  API_MODE="local"
fi

if [[ "$API_MODE" == "local" ]]; then
  echo "📦 Running API locally with cargo..."
  (
    cd "$API_DIR"
    DATABASE_URL="postgresql://riviamigo:devpassword@localhost:5432/riviamigo" \
    REDIS_URL="redis://localhost:6379" \
    S3_ENDPOINT="http://localhost:3900" \
    S3_ACCESS_KEY="GKdeadbeef0000000000000000000000" \
    S3_SECRET_KEY="deadbeef0000000000000000000000000000000000000000000000000000cafe" \
    PORT="3001" \
    ALLOWED_ORIGINS="http://localhost:5173" \
    cargo run
  ) &
  API_PID=$!
else
  echo "📦 Rust toolchain not found; building and running the API container instead..."
  if run_with_timeout 600 env DOCKER_BUILDKIT=1 docker compose --progress=plain -f "$COMPOSE_FILE" build api; then
    :
  else
    build_status=$?
    if [[ $build_status -eq 124 ]]; then
      echo "❌ Docker Compose did not finish building the API image within 600 seconds."
    else
      echo "❌ Docker Compose failed while building the API image."
    fi
    exit 1
  fi

  if run_with_timeout 120 docker compose -f "$COMPOSE_FILE" up -d api; then
    :
  else
    api_status=$?
    if [[ $api_status -eq 124 ]]; then
      echo "❌ Docker Compose did not start the API container within 120 seconds."
    else
      echo "❌ Docker Compose failed to start the API container."
    fi
    exit 1
  fi
fi

if wait_for_api_ready 120; then
  echo "✅ API is responding at $API_HEALTH_URL"
else
  exit 1
fi

echo "📝 To view infra logs in another terminal, run:"
echo "   docker compose -f $COMPOSE_FILE logs -f"
echo ""

WEB_MODE="managed"

if curl -fsS --max-time 2 "$WEB_URL" >/dev/null 2>&1; then
  WEB_MODE="external"
  echo "✅ Web dev server is already responding at $WEB_URL"
else
  (
    cd "$ROOT_DIR"
    pnpm --filter @riviamigo/web dev -- --strictPort --port 5173
  ) &
  WEB_PID=$!

  if wait_for_web_ready 120; then
    echo "✅ Web dev server is responding at $WEB_URL"
  else
    exit 1
  fi
fi

API_UNHEALTHY_CHECKS=0
WEB_UNHEALTHY_CHECKS=0

while true; do
  if [[ "$API_MODE" == "local" ]]; then
    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "❌ API dev server exited."
      exit 1
    fi
  else
    if curl -fsS --max-time 2 "$API_HEALTH_URL" >/dev/null 2>&1; then
      API_UNHEALTHY_CHECKS=0
    else
      API_UNHEALTHY_CHECKS=$((API_UNHEALTHY_CHECKS + 1))
      api_status="$(api_container_status || true)"

      if [[ "$api_status" == "exited" || "$api_status" == "dead" ]]; then
        echo "❌ API container is no longer running."
        print_api_logs
        exit 1
      fi

      if [[ $API_UNHEALTHY_CHECKS -ge 5 ]]; then
        echo "❌ API health endpoint is no longer responding."
        print_api_logs
        exit 1
      fi
    fi
  fi

  if [[ "$WEB_MODE" == "managed" ]]; then
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
      echo "❌ Web dev server exited."
      exit 1
    fi
  else
    if curl -fsS --max-time 2 "$WEB_URL" >/dev/null 2>&1; then
      WEB_UNHEALTHY_CHECKS=0
    else
      WEB_UNHEALTHY_CHECKS=$((WEB_UNHEALTHY_CHECKS + 1))

      if [[ $WEB_UNHEALTHY_CHECKS -ge 5 ]]; then
        echo "❌ Web dev server is no longer responding at $WEB_URL."
        exit 1
      fi
    fi
  fi

  sleep 1
done
