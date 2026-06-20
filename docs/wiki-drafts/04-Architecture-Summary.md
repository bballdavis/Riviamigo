# Architecture Summary

This page describes Riviamigo's system design for contributors and anyone who wants to understand how the pieces fit together.

---

## Monorepo Layout

```
apps/api/          Rust · Axum 0.7 · sqlx 0.7 — REST API and telemetry ingestion
apps/web/          React 18 · Vite 5 · TanStack Router/Query — web frontend
packages/
  hooks/           React Query hooks, API client, Zustand auth store
  ui/              Design system: primitives, charts, tables, Storybook
  types/           Shared TypeScript type definitions
  config/          Shared TypeScript, ESLint, and Tailwind configurations
infra/             Docker Compose files (TimescaleDB, Redis, Garage S3)
scripts/           Dev and deployment helper scripts
docs/              Architecture docs, auth notes, metrics reference
```

---

## Services

### Rust API (`apps/api/`) — port 3001

Built with [Axum](https://github.com/tokio-rs/axum) 0.7. All routes except `/health` and `/grafana/*` require `Authorization: Bearer <token>`.

The router is assembled in `apps/api/src/routes/mod.rs` via `build_router()`. Route modules:

| Module | Responsibility |
|--------|---------------|
| `auth.rs` | Login, logout, token refresh, OTP flow |
| `vehicles.rs` | Vehicle CRUD, settings |
| `battery.rs` | Battery health and capacity queries |
| `charging.rs` | Charge session history and curves |
| `trips.rs` | Trip history and efficiency |
| `stats.rs` | Aggregated stats and metrics |
| `efficiency.rs` | Efficiency computations |
| `live.rs` | Live telemetry (SSE or polling) |
| `grafana.rs` | SimpleJSON datasource stub |

**Rate limiting** (`tower_governor`): auth routes burst=10, protected routes burst=20.

### React Frontend (`apps/web/`) — port 3000

Served as static assets via Nginx in production. Uses file-based routing via `@tanstack/react-router`. All data fetching goes through hooks in `packages/hooks/src/`.

The core page abstraction is `DashboardPageShell` — it owns auth guard, layout, dashboard config, date range state, and edit/view mode. Route files are thin: they declare path params and mount the shell.

### TimescaleDB — port 5432

PostgreSQL with the TimescaleDB extension. Two schemas:

- `riviamigo.*` — application tables (users, vehicles, trips, charge_sessions, refresh_tokens, system_config, etc.)
- `timeseries.telemetry` — main hypertable. One row per WebSocket push, indexed by `(vehicle_id, time)`.

**Continuous aggregates:**

| View | Bucket | Used for |
|------|--------|----------|
| `timeseries.telemetry_1min` | 1 minute | Charge rate curves |
| `timeseries.odometer_daily` | 1 day | Odometer / distance reporting |

### Redis — port 6379

Used for:
- Session state during OTP challenges
- Refresh token rotation locking (prevents concurrent refresh races)
- Short-lived rate-limit state (via `tower_governor`)

### Garage S3 (optional) — port 3900

A self-hosted S3-compatible object store included in the development Compose file. Used for database backup storage. In production, replace with MinIO, Backblaze B2, or any S3-compatible provider.

---

## Rivian Connection

Riviamigo connects to Rivian's unofficial GraphQL API using the same protocol as the mobile app.

- **WebSocket**: `wss://api.rivian.com/gql-consumer-subscriptions/graphql` — real-time telemetry pushes.
- **Poll loop** (`ingestion/rivian_poll.rs` + `ingestion/poller.rs`) — adaptive follow-up work based on vehicle power state. This loop periodically reconciles completed charging sessions with Rivian's charging history, captures live charging curve data while a session is active, and records sync timestamps so stale gaps are visible.
- **Supervisor** (`ingestion/supervisor.rs`) — keeps one active connection per vehicle, restarts with exponential backoff on failure.
- **Worker watchdog** (`ingestion/worker.rs`) — restarts a collector that stays connected but stops receiving WebSocket messages, which prevents a silent lock-holder from leaving status, trips, and charging history stale indefinitely.
- **Parser** (`ingestion/parser.rs`) — normalizes raw GraphQL payloads and writes rows to `timeseries.telemetry`.

---

## Authentication

| Mechanism | Details |
|-----------|---------|
| JWT (RS256) | 15-minute access tokens. Keypair auto-generated on first boot and stored in `system_config` if not provided via env. |
| Refresh cookie | HttpOnly cookie, 30-day lifetime. Rotation is mutex-locked in Redis to prevent race conditions. |
| API keys | `rmigo_` prefix. Stored as SHA256 hashes. Presented as Bearer tokens. |

The `AuthUser` extractor in `middleware/auth.rs` accepts both JWT and API key tokens on all protected routes.

---

## Secrets and Encryption

- **Rivian credentials** — stored age-encrypted (X25519) in the `riviamigo.vehicles` table. The age key is auto-generated on first boot and stored in `system_config`, or provided via `AGE_ENCRYPTION_KEY` env var.
- **Database passwords** — provided via `DATABASE_URL`.
- **Refresh tokens** — stored as SHA256 hashes; raw values are never persisted.

---

## Packages

| Package | Description |
|---------|-------------|
| `@riviamigo/hooks` | React Query hooks wrapping every API endpoint. All API access in the frontend goes through `packages/hooks/src/api.ts`. |
| `@riviamigo/ui` | Design system — charts, tables, form primitives, sensor chips. Uses `--rm-*` CSS custom properties for theming. |
| `@riviamigo/types` | Shared TypeScript types consumed by both `hooks` and `web`. |
| `@riviamigo/config` | Shared tsconfig, ESLint config, and Tailwind base config used across the monorepo. |
