# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What this is

Riviamigo is a self-hosted Rivian telemetry dashboard. The API connects to Rivian's unofficial cloud WebSocket, ingests telemetry into TimescaleDB, and exposes it through a typed REST API consumed by a React SPA.

---

## Commands

### Full dev stack (recommended)
```bash
./scripts/dev.sh          # starts infra containers + Vite dev server; runs API locally via cargo if available
pnpm run dev:stack         # same, launched via Node wrapper
```

### Individual services
```bash
pnpm dev                   # Vite dev server only (needs API + infra already up)
pnpm build                 # build all packages
pnpm typecheck             # tsc across all packages
pnpm lint                  # ESLint across all packages
pnpm test                  # Vitest unit tests
pnpm storybook             # Storybook component explorer
```

### API (Rust) — from `apps/api/`
```bash
cargo run                  # run API locally (needs DATABASE_URL + REDIS_URL env vars)
cargo test                 # run all tests (unit only; integration tests need DATABASE_URL)
cargo test -- --ignored    # also run integration tests (requires live DB)
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all --check
cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info
```

### Frontend tests — from `apps/web/`
```bash
pnpm --filter @riviamigo/web test             # run unit tests
pnpm --filter @riviamigo/web test:coverage    # run with coverage (threshold: 70% lines)
pnpm --filter @riviamigo/web test:e2e         # Playwright e2e
```
Run a single test file:
```bash
pnpm --filter @riviamigo/web exec vitest run src/routes/__tests__/battery.test.tsx
```

### Database
```bash
pnpm db:migrate            # sqlx migrate run (against DATABASE_URL)
pnpm db:reset              # drop + recreate + migrate
```

Reset the full local stack (deletes all data):
```bash
COMPOSE_PROJECT_NAME=riviamigo docker compose -f infra/docker-compose.yml down -v --remove-orphans
```

---

## Architecture

### Monorepo layout

```
apps/api/          Rust · Axum 0.7 · sqlx 0.7 · TimescaleDB
apps/web/          React 18 · Vite 5 · TanStack Router/Query
packages/
  dashboards/      Dashboard schema, renderer, widget registry, default configs
  hooks/           React Query hooks + API client + Zustand auth store
  ui/              Design system: primitives, charts, tables, Storybook
  types/           Shared TypeScript types
  config/          Shared TS / ESLint / Tailwind configs
infra/             docker-compose (TimescaleDB, Redis, Garage S3)
```

### Rust API

- **Router** built in `apps/api/src/routes/mod.rs` via `build_router()`. All routes except `/health` and `/grafana/*` require `Authorization: Bearer <token>`.
- **Auth** (`middleware/auth.rs`): `AuthUser` extractor handles both JWT (RS256, 15-min) and API key (`rmigo_*` prefix, SHA256 hashed). JWT keypair is auto-generated on first boot and stored in the `system_config` DB table if not provided via env.
- **AppState** holds `PgPool`, `redis::Client`, `Arc<JwtKeys>`, the age encryption key, and the `Config` struct loaded from environment via `envy`.
- **Rate limiting**: `tower_governor` applied — auth routes burst=10 (~10 req/min), protected routes burst=20 (~120 req/min) in `routes/mod.rs`.
- **Telemetry ingestion**: `apps/api/src/ingestion/` runs a supervisor that keeps a Rivian WebSocket connection alive per vehicle. The poller (`rivian_poll.rs`) backs this up with periodic REST calls. The parser writes into `timeseries.telemetry`.
- **sqlx**: All queries use `sqlx::query!()` / `sqlx::query_as!()` (compile-time checked). `SQLX_OFFLINE=true` is set in the Dockerfile for offline builds. The `metrics.rs` route has two `format!()` interpolations into SQL (`column`, `aggregate`) — both are validated against an allowlist before use.
- **Migrations**: in `apps/api/migrations/`. Run automatically on startup or via `pnpm db:migrate`.

### Frontend

- **Routing**: file-based via `@tanstack/react-router`. Route files are thin — they declare path/params and mount either a `DashboardPageShell` wrapper or a route-local component.
- **Data fetching**: `@tanstack/react-query` via hooks in `packages/hooks/src/`. All API access goes through `packages/hooks/src/api.ts`.
- **Dashboard system**: The core abstraction is `DashboardPageShell` (`apps/web/src/components/dashboard/DashboardPageShell.tsx`) — it owns auth guard, layout, dashboard config fetch, date range state, and edit/view mode. Route files mount it; they do not recreate it.
  - `DashboardRenderer` (`packages/dashboards/src/DashboardRenderer.tsx`) is grid layout only — no page logic.
  - Widget registry lives in `packages/dashboards/src/registry.tsx`.
  - Built-in default configs are JSON files in `packages/dashboards/src/defaults/`.
  - Widget component types: `custom`, `sensor`, `chart`.
- **Auth state**: Zustand store in `packages/hooks/src/` manages the access token; refresh token is an HttpOnly cookie handled automatically.

### Database schema

- `riviamigo.*` — application tables (users, vehicles, trips, charge_sessions, refresh_tokens, etc.)
- `timeseries.telemetry` — main hypertable (raw WebSocket snapshots, one row per push)
- `timeseries.telemetry_1min` — 1-minute continuous aggregate used by charging curve queries
- `timeseries.odometer_daily` — daily odometer aggregate
- Battery capacity is read from `timeseries.telemetry` directly (not a separate snapshot table).

---

## Key conventions

### Colors — mandatory
All colors must use design tokens. Never write hex literals, `rgb()`/`rgba()`, named CSS colors, or arbitrary Tailwind values (`bg-[#1a1a1a]`, `text-blue-500`).
- **Tailwind**: use semantic classes — `bg-bg-elevated`, `text-fg-tertiary`, `border-accent`, `text-status-positive`
- **Inline styles / CSS**: use `var(--rm-*)` tokens. For opacity: `color-mix(in oklab, var(--rm-accent) 50%, transparent)`
- **Form controls**: `accent-color: var(--rm-accent)` — never rely on browser-default blue
- If a needed color is missing, add a `--rm-*` token to `packages/ui/src/tokens/globals.css` and bridge it in `apps/web/src/index.css`
- Pre-PR grep: `#[0-9a-fA-F]{3,8}`, `rgb(`, `rgba(`, `*-blue-*`, `*-indigo-*`, `*-sky-*`

### Dashboard boundaries
- Route files stay thin — path declaration, params, and mounting the shell
- `DashboardPageShell` owns all shared scaffold behavior (edit mode, date range, auth guard, action buttons)
- `DashboardRenderer` is layout-only — no slug checks, no page-specific business logic
- Page-specific UI (hero panels, tabs, detail strips) goes in explicit page composition passed into the shell, not in `if (slug === ...)` branches
- Sensor chips (`componentType: "sensor"`) are the default for stat cards — define behavior in `sensorDefinitions.ts`, not one-off TSX wrappers
- Default and user dashboards share the same edit/save/cancel/lock/clone/import/export model — change the shared shell, not per-route copies

### Widgets
- Each widget calls its own hook(s), renders generic `@riviamigo/ui` components, and stays focused on one concern
- Shared derived data across widgets → page-specific hook or adapter, not duplicated fetch logic

### Frontend tests
- Test files in `apps/web/src/routes/__tests__/` follow the pattern: mock all workspace packages with `vi.mock`, use `mockPrimitives` from `../../test/mockPrimitives`, stub charts/tables inline
- `apps/web/src/test/setup.ts` stubs canvas, Path2D, ResizeObserver, matchMedia for jsdom
- Integration (DB-dependent) Rust tests are marked `#[ignore = "requires DATABASE_URL"]` and run via `cargo test -- --ignored`

### Rivian auth
Before modifying the vehicle connection / OTP flow, read `docs/rivian-auth.md` and compare against the current Home Assistant Rivian integration — the upstream API shape is unofficial and changes.
