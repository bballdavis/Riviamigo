# Riviamigo

Rivian telemetry dashboard — deep insight into battery, trips, charging, and efficiency. Built with Rust + Axum on the backend, React + TanStack on the frontend, TimescaleDB for telemetry storage.

## Architecture

```
apps/
  api/          # Rust · Axum 0.7 · sqlx · TimescaleDB
  web/          # React 18 · Vite 5 · TanStack Router/Query
packages/
  ui/           # Design system: primitives, charts, tables, Storybook
  hooks/        # React Query hooks + API client + Zustand auth store
  types/        # Shared TypeScript types
  config/       # Shared TS, ESLint, Tailwind configs
infra/
  docker-compose.yml   # TimescaleDB, Redis, Garage
apps/
  api/migrations/      # sqlx migrations
```

## Prerequisites

- **Rust** (stable): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node 20+**: `brew install node` or from https://nodejs.org
- **pnpm 9+**: `brew install pnpm` or `npm install -g pnpm`
- **Docker + Docker Compose**: Download Docker Desktop from https://www.docker.com/products/docker-desktop

## Quick start

### 1. Install dependencies

```bash
# Clone the repo
git clone https://github.com/bballdavis/Riviamigo.git
cd Riviamigo

# Install pnpm if you haven't already
brew install pnpm

# Install Node dependencies
pnpm install
```

### 2. Start development

The dev script starts the full development stack — infrastructure (database, cache, S3) plus the API and Vite dev server. If `cargo` is available, the API runs locally; otherwise the script builds and runs the API container. On local Rust startup, the script first applies the checked-in SQL migrations to the dev database so `sqlx` can compile cleanly against an empty first-run database.

On first boot, the API applies a single flat baseline migration that creates the application schema, the telemetry hypertable, and the derived `timeseries.*` views the routes expect. The bootstrap does not install Timescale continuous aggregate or compression jobs.

```bash
./scripts/dev.sh
```

OR

```bash
pnpm run dev:stack
```

The dev script will output the URLs where services are running:
- **Web**: http://localhost:5173 (React + Vite)
- **API**: http://localhost:3001 (Rust + Axum)
- **Database**: postgresql://localhost:5432
- **Redis**: redis://localhost:6379
- **S3**: http://localhost:3900

To watch API logs in another terminal:
```bash
docker compose -f infra/docker-compose.yml logs -f api
```

To reset back to a clean local baseline, remove the Riviamigo containers, network, and named volumes for the tracked Compose project:

```bash
COMPOSE_PROJECT_NAME=riviamigo docker compose -f infra/docker-compose.yml down -v --remove-orphans
```

The API container automatically generates an RSA-2048 JWT keypair and age X25519 encryption key on first boot, storing them in the database. No manual secret generation needed.

To use custom keys (e.g., for production or key rotation), pass them as environment variables:

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add (optional):
# JWT_SECRET=<your-private-key-pem>
# JWT_PUBLIC_KEY=<your-public-key-pem>
# AGE_ENCRYPTION_KEY=AGE-SECRET-KEY-...

# Then rebuild and restart
docker compose -f infra/docker-compose.yml up -d --build
```

### 3. Connect your Rivian

1. Create an account at `/login`
2. Navigate to Settings → Add Vehicle
3. Enter your Rivian credentials (encrypted with the auto-generated age key)
4. Complete the OTP step if prompted

Rivian cloud authentication uses an unofficial API shape that can change. Before
changing onboarding/auth code, compare against [`docs/RIVIAN_AUTH.md`](docs/RIVIAN_AUTH.md)
and the current Home Assistant Rivian integration.

## Scripts

**Recommended — Use these shell scripts:**

```bash
# Development: Start full stack (infrastructure + Vite dev server)
./scripts/dev.sh

# Same full-stack flow, but launched through a terminal-native wrapper
pnpm run dev:stack

# Production: Build all packages for production (workspace artifacts, not Docker images)
./scripts/build.sh

# Production: Build + start API server (requires Docker infrastructure)
./scripts/start.sh
```

**Or use pnpm directly:**

```bash
# Development
pnpm dev              # Start web dev server only (requires the API and infra to already be running)
pnpm build            # Build all packages for production
pnpm typecheck        # Run TypeScript checks
pnpm lint             # Run ESLint
pnpm test             # Run tests
pnpm storybook        # Start component explorer (Storybook)
```

**Docker infrastructure (run independently):**

Use this only if you want the infra containers without the web/dev server. For normal development, `./scripts/dev.sh` is the supported entrypoint.

```bash
# Start all services (database, redis, S3, API)
docker compose -f infra/docker-compose.yml up -d

# Watch API logs
docker compose -f infra/docker-compose.yml logs -f api

# Stop services (keeps data)
docker compose -f infra/docker-compose.yml down

# Stop services and delete all data
docker compose -f infra/docker-compose.yml down -v
```

**Local Rust development (advanced — without Docker):**

```bash
cd apps/api
DATABASE_URL="postgresql://riviamigo:devpassword@localhost:5432/riviamigo" \
REDIS_URL="redis://localhost:6379" \
S3_ENDPOINT="http://localhost:3900" \
S3_ACCESS_KEY="GKdeadbeef0000000000000000000000" \
S3_SECRET_KEY="deadbeef0000000000000000000000000000000000000000000000000000cafe" \
cargo run
```

## Development

```bash
# Run all typechecks
pnpm turbo typecheck

# Run all linters
pnpm turbo lint

# Storybook (component explorer)
pnpm --filter @riviamigo/ui storybook
```

## Design system

Minimalist dark-first (amber on layered slate). All tokens live in `packages/ui/src/tokens/`:

| Token file    | Contents                                      |
|---------------|-----------------------------------------------|
| `globals.css` | CSS custom properties for dark + light themes |
| `colors.ts`   | Semantic color constants                      |
| `typography.ts` | Font stacks, sizes, weights                 |
| `spacing.ts`  | Spacing, layout, motion easing                |

Toggle theme by adding `.dark` or `.light` to `<html>`. The FOUC-prevention script in `index.html` reads `localStorage('rm-theme')` before first paint.

## API

Base URL: `http://localhost:3001`

Rivian connect flow implementation notes are in [`docs/RIVIAN_AUTH.md`](docs/RIVIAN_AUTH.md).

| Verb | Path | Description |
|------|------|-------------|
| POST | `/v1/auth/register` | Create account |
| POST | `/v1/auth/login` | Login → access token + refresh cookie |
| POST | `/v1/auth/refresh` | Rotate tokens |
| POST | `/v1/auth/logout` | Revoke refresh token |
| GET  | `/v1/vehicles` | List vehicles |
| POST | `/v1/vehicles/connect` | Rivian login step 1 |
| POST | `/v1/vehicles/connect/otp` | Rivian OTP step 2 |
| GET  | `/v1/vehicles/status?vehicle_id=` | Latest snapshot |
| GET  | `/v1/vehicles/live?vehicle_id=` | WebSocket live feed |
| GET  | `/v1/battery/soc` | SoC time series |
| GET  | `/v1/battery/range` | Range time series |
| GET  | `/v1/battery/phantom-drain` | Overnight drain per day |
| GET  | `/v1/trips` | Paginated trip list |
| GET  | `/v1/trips/:id` | Trip detail |
| GET  | `/v1/trips/:id/track` | GPS track points |
| GET  | `/v1/trips/:id/speed` | Speed profile |
| GET  | `/v1/charging` | Paginated charge sessions |
| GET  | `/v1/charging/summary` | Aggregate stats |
| GET  | `/v1/charging/:id/curve` | Charge curve (power vs SoC) |
| GET  | `/v1/efficiency/summary` | avg / p10 / p90 |
| GET  | `/v1/efficiency/by-mode` | Breakdown by drive mode |
| GET  | `/v1/stats` | Lifetime totals |

All data endpoints require `Authorization: Bearer <token>` and `?vehicle_id=<uuid>`.

## Deployment notes

**Secrets:**
- JWT and age keys are auto-generated on first container boot and stored in the database
- To rotate keys: generate new ones locally, set `JWT_SECRET`, `JWT_PUBLIC_KEY`, `AGE_ENCRYPTION_KEY` env vars, and restart the container
- The database volume persists keys across restarts (use `docker compose down -v` to reset)

**Infrastructure:**
- Set `ALLOWED_ORIGINS` to your production domain
- Run behind a reverse proxy (nginx/caddy) that terminates TLS
- The local baseline migration intentionally skips Timescale background policies on first boot
- For offline Rust builds: `cargo sqlx prepare` to embed query metadata

## License

MIT
