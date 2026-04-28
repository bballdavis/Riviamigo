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

- Rust (stable) + cargo
- Node 20+, pnpm 9+
- Docker + Docker Compose
- `age` CLI: `brew install age`
- `openssl`

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/bballdavis/Riviamigo.git
cd Riviamigo
npm install
```

### 2. Generate secrets

```bash
# JWT RS256 keypair
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem

# age encryption key (for Rivian credentials at rest)
age-keygen -o age_key.txt
# Copy the public key line from age_key.txt into .env
```

> Keep all generated secret files local. Do not commit `jwt_private.pem`, `age_key.txt`, or any `.env` file to the repository.

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in AGE_PUBLIC_KEY from the age-keygen output
```

### 4. Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 5. Run migrations

```bash
cd apps/api
cargo sqlx migrate run
```

### 6. Start services

```bash
# Terminal 1 — API
cd apps/api
cargo run

# Terminal 2 — Web
pnpm dev --filter @riviamigo/web
```

Open [http://localhost:5173](http://localhost:5173).

### 7. Connect your Rivian

1. Create an account at `/login`
2. Navigate to Settings → Add Vehicle
3. Enter your Rivian credentials (they're encrypted with `age` before storage)
4. Complete the OTP step if prompted

## Scripts

All common tasks are available as npm scripts:

```bash
# Development
pnpm dev              # Start all dev servers (API + web)
pnpm build            # Build all packages

# Production
pnpm start            # Run production API server (auto-builds web if needed)

# Quality assurance
pnpm typecheck        # Run TypeScript checks across all packages
pnpm lint             # Run ESLint across all packages
pnpm test             # Run tests across all packages

# Infrastructure
pnpm db:migrate       # Run database migrations
pnpm db:reset         # Drop, recreate, and migrate database
pnpm storybook        # Start component explorer
pnpm clean            # Clean all build artifacts and node_modules
```

Or use the shell scripts directly from `scripts/`:

```bash
./scripts/dev.sh      # Start development servers
./scripts/build.sh    # Build for production
./scripts/start.sh    # Run production server
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

- Set `ALLOWED_ORIGINS` to your production domain
- Run behind a reverse proxy (nginx/caddy) that terminates TLS
- `cargo sqlx prepare` to embed query metadata for offline builds
- TimescaleDB compression kicks in after 30 days automatically

## License

MIT
