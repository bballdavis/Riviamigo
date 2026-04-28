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
  docker-compose.yml   # TimescaleDB, Redis, MinIO
  migrations/          # sqlx migrations
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

### 2. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

The API container automatically generates a RSA-2048 JWT keypair and age X25519 encryption key on first boot, storing them in the database. No manual secret generation needed.

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

### 3. Start services

Open two terminals:

**Terminal 1 — Watch API logs:**
```bash
docker compose -f infra/docker-compose.yml logs -f api
```

The API will auto-generate keys on first startup (takes ~10 seconds).

**Terminal 2 — Start web dev server:**
```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) when the dev server is ready.

### 4. Connect your Rivian

1. Create an account at `/login`
2. Navigate to Settings → Add Vehicle
3. Enter your Rivian credentials (encrypted with the auto-generated age key)
4. Complete the OTP step if prompted

## Scripts

**Use these commands in the repo root:**

```bash
# Development
pnpm dev              # Start web dev server (requires docker-compose running)
pnpm build            # Build all packages for production
pnpm typecheck        # Run TypeScript checks
pnpm lint             # Run ESLint
pnpm test             # Run tests
pnpm storybook        # Start component explorer

# Or use the shell scripts:
./scripts/dev.sh      # Same as pnpm dev
./scripts/build.sh    # Same as pnpm build
./scripts/start.sh    # Build + start API server (production mode)
```

**Docker infrastructure:**

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
- TimescaleDB compression kicks in after 30 days automatically
- For offline Rust builds: `cargo sqlx prepare` to embed query metadata

## License

MIT
