# Development Setup

This page walks through setting up a local development environment for Riviamigo. All services run locally, and the Vite dev server provides hot module replacement for frontend changes.

---

## Prerequisites

Install the following before starting:

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | 1.75+ | [rustup.rs](https://rustup.rs) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) or `nvm` |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker Compose | v2 | Included with Docker Desktop |

---

## Step-by-Step Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_ORG/riviamigo.git
cd riviamigo
```

### 2. Install frontend dependencies

```bash
pnpm install
```

### 3. Create your local environment file

```bash
cp .env.example .env
```

Leave `RIVIAMIGO_ENV=development` and `COOKIE_INSECURE=1` as-is for local development. These settings allow the auth cookie to work without HTTPS.

### 4. Start infrastructure containers

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts TimescaleDB, Redis, and Garage (local S3). The database schema migrations run automatically when the API first starts.

### 5a. All-in-one dev startup (recommended)

```bash
./scripts/dev.sh
```

This script starts the infrastructure containers, runs `cargo run` for the API, and starts the Vite dev server. All output is multiplexed to the terminal.

### 5b. Manual startup (if you prefer separate terminals)

**Terminal 1 — API:**

```bash
cd apps/api
cargo run
```

**Terminal 2 — Web dev server:**

```bash
pnpm dev
```

The API runs on port 3001. The Vite dev server runs on port 5173 (or 3000 depending on config) and proxies API requests.

---

## Running Tests

### Rust (API)

```bash
# From apps/api/ or repo root
cargo test --all                    # unit tests only
cargo test --all -- --ignored       # includes integration tests (requires live DATABASE_URL)
```

### Frontend

```bash
pnpm test                           # all unit tests via Vitest
pnpm --filter @riviamigo/web test   # web package only

# Run a single test file
pnpm --filter @riviamigo/web exec vitest run src/routes/__tests__/battery.test.tsx

# With coverage (threshold: 70% lines)
pnpm --filter @riviamigo/web test:coverage

# End-to-end (Playwright)
pnpm --filter @riviamigo/web test:e2e
```

---

## Useful Commands Reference

| Command | Description |
|---------|-------------|
| `cargo fmt --all --check` | Check Rust formatting |
| `cargo fmt --all` | Auto-format Rust code |
| `cargo clippy --all-targets --all-features -- -D warnings` | Run Clippy linter |
| `cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info` | Generate code coverage |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | Run `tsc` across all packages |
| `pnpm build` | Build all packages |
| `pnpm storybook` | Start Storybook component explorer |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm db:reset` | Drop, recreate, and migrate the database |

---

## Resetting the Local Stack

To tear down all containers and wipe all local data:

```bash
COMPOSE_PROJECT_NAME=riviamigo docker compose -f infra/docker-compose.yml down -v --remove-orphans
```

This deletes the TimescaleDB volume, so all telemetry data is lost. Re-run `docker compose up -d` and the migrations will re-apply on the next API start.

---

## IDE Setup

**VS Code** — install the following extensions:

- `rust-analyzer` — Rust language server
- `Even Better TOML` — Cargo.toml support
- `ESLint` — frontend linting
- `Tailwind CSS IntelliSense` — autocomplete for Tailwind classes (including custom tokens)

**sqlx offline mode** — if you see `sqlx` compile errors about missing database, the offline query cache may be stale:

```bash
cd apps/api
cargo sqlx prepare --workspace
```

This regenerates `.sqlx/` query metadata from a live database connection. The `SQLX_OFFLINE=true` flag is used in Docker builds to skip the live DB requirement.
