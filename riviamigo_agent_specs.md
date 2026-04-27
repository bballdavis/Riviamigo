# RivianMate — Agent Build Specification
## Full-Stack Vehicle Analytics Platform for Rivian Owners

> **For the agent:** This document is your complete source of truth. Read every section before writing any code. The architecture decisions here are intentional — do not substitute alternatives without explicit instruction. Follow the repo structure exactly, implement testing as specified, and reference the brand/design token system for every UI component you create. When in doubt, refer back to this document.

---

## Table of Contents

1. [Vision & Product Goals](#1-vision--product-goals)
2. [Technology Stack](#2-technology-stack)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Data Ingestion Architecture](#4-data-ingestion-architecture)
5. [Database Schema](#5-database-schema)
6. [Metric Computation Strategy](#6-metric-computation-strategy)
7. [Backend — Rust API](#7-backend--rust-api)
8. [Brand & Design Token System](#8-brand--design-token-system)
9. [Chart System — Modular & Tokenized](#9-chart-system--modular--tokenized)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Dashboard & Page Inventory](#11-dashboard--page-inventory)
12. [Testing Strategy](#12-testing-strategy)
13. [Storybook Structure](#13-storybook-structure)
14. [Infrastructure & DevOps](#14-infrastructure--devops)
15. [Security Requirements](#15-security-requirements)
16. [Build Order & Agent Instructions](#16-build-order--agent-instructions)

---

## 1. Vision & Product Goals

RivianMate is a self-hosted vehicle analytics platform for Rivian R1T and R1S owners. It is the Rivian equivalent of TeslaMATE — but with a premium, consumer-grade UI built in from day one rather than bolted onto Grafana dashboards.

### Core differentiators from TeslaMATE

| TeslaMATE | RivianMate |
|-----------|------------|
| Grafana for all visualization | Custom React UI with rich interactive charts |
| Raw data + user-built dashboards | Pre-built, curated dashboards accessible to non-technical owners |
| Polling-based data collection | WebSocket-first (Rivian's native push API) + adaptive polling |
| Single-user assumed | Multi-user ready with per-user vehicle scoping |
| Minimal visual design | Premium brand system, mobile-first, dark mode native |

### What we are building (MVP scope)

- Continuous vehicle data collection via Rivian's unofficial GraphQL API
- TimescaleDB time-series storage with pre-aggregated materialized views
- Rust/Axum REST API serving pre-computed metrics as typed JSON
- React web dashboard with the full chart/table suite
- React Native mobile app sharing core hooks and types
- Grafana-compatible secure API endpoints for power users
- Comprehensive test coverage and Storybook component library

### Reference applications for visual inspiration

- **Rivian Roamer** — premium map/trip aesthetic, dark interface
- **Teslarati** — consumer-friendly data presentation
- **TeslaMATE dashboards** — the metrics inventory we want to match or exceed (see Section 11)
- **Linear.app** — interaction quality and table UX benchmark
- **Stripe Dashboard** — summary stat cards and data density done right

---

## 2. Technology Stack

### Backend

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | Rust (stable) | High concurrency for WebSocket + many user connections; type safety for API contracts |
| HTTP framework | Axum 0.7 | Built on Tokio; excellent middleware composability; native async |
| Async runtime | Tokio | Industry standard; required by Axum and tokio-tungstenite |
| Database driver | sqlx 0.7 (async, compile-time checked) | Async Postgres; compile-time query validation |
| Migrations | sqlx migrate | Built into sqlx; version-controlled SQL files |
| WebSocket client | tokio-tungstenite | Tokio-native WS client for Rivian subscription connection |
| HTTP client | reqwest | For Rivian GraphQL POST polling |
| Serialization | serde + serde_json | Standard; derive macros for all API types |
| Auth | jsonwebtoken (RS256) | JWT for our own API; session token storage for Rivian creds |
| Encryption | age (encrypt/decrypt) | Encrypt stored Rivian session tokens at rest |
| Middleware | tower + tower-http | CORS, compression, request ID, tracing |
| Rate limiting | tower-governor | Per-user rate limiting on API endpoints |
| Observability | tracing + tracing-subscriber | Structured logging; OpenTelemetry compatible |
| Testing | cargo test + testcontainers | Unit + integration tests with real DB containers |
| Property testing | proptest | Fuzz telemetry parser with generated inputs |

### Database

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Primary time-series | TimescaleDB 2.x (on Postgres 16) | Hypertables + continuous aggregates = TeslaMATE/Grafana query performance in our own API |
| Relational data | PostgreSQL 16 (same instance, separate schema) | Users, vehicles, trips metadata, config |
| Cache / pub-sub | Redis 7 | Rate limiting counters; fan live WS telemetry to multiple clients |
| Object storage | MinIO (self-hosted S3-compatible) | GPX exports, CSV exports, static assets |

### Frontend — Web

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React 18 + TypeScript (strict) | Industry standard; large ecosystem |
| Build tool | Vite 5 | Fast dev server; ESM-native |
| Styling | Tailwind CSS 3 with custom design tokens | Utility-first; all tokens defined in `tailwind.config.ts` |
| Charts | Recharts 2 + D3 v7 | Recharts for standard charts; D3 for custom (trip maps, battery rings) |
| Tables | TanStack Table v8 | Headless; handles sort/filter/pagination/virtualization |
| Data fetching | TanStack Query v5 (React Query) | Cache, background refetch, WebSocket integration |
| Routing | TanStack Router | Type-safe routes |
| Forms | React Hook Form + Zod | Type-safe forms with runtime validation |
| Maps | Maplibre GL JS | Open-source; self-hosted tiles via Protomaps |
| Animation | Framer Motion | Page transitions; chart entry animations |
| Icons | Lucide React | Consistent, tree-shakeable |
| State | Zustand | Lightweight global state for live vehicle status |

### Frontend — Mobile

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.74 + Expo SDK 51 |
| Navigation | Expo Router (file-based) |
| Shared code | `packages/hooks` and `packages/types` from monorepo |
| Charts | Victory Native (wraps D3 for RN) |

### Tooling

| Tool | Purpose |
|------|---------|
| pnpm workspaces | Monorepo package management |
| Turborepo | Build orchestration and caching |
| Storybook 8 | Component development and documentation |
| Vitest | Unit and component testing (web) |
| React Testing Library | Component integration tests |
| Playwright | E2E tests |
| ESLint + Prettier | Code style |
| cargo-audit | Rust dependency vulnerability scanning |
| cargo-clippy | Rust linting (deny warnings in CI) |
| Docker Compose | Local development environment |
| GitHub Actions | CI/CD |

---

## 3. Monorepo Structure

```
rivianmate/
├── apps/
│   ├── web/                          # React web dashboard (Vite)
│   │   ├── src/
│   │   │   ├── routes/               # TanStack Router file-based routes
│   │   │   │   ├── __root.tsx
│   │   │   │   ├── index.tsx         # Dashboard home
│   │   │   │   ├── battery/
│   │   │   │   │   └── index.tsx
│   │   │   │   ├── trips/
│   │   │   │   │   ├── index.tsx     # Trips list
│   │   │   │   │   └── $tripId.tsx   # Trip detail
│   │   │   │   ├── charging/
│   │   │   │   │   ├── index.tsx
│   │   │   │   │   └── $sessionId.tsx
│   │   │   │   ├── efficiency/
│   │   │   │   │   └── index.tsx
│   │   │   │   └── settings/
│   │   │   │       └── index.tsx
│   │   │   ├── components/           # Page-level composed components
│   │   │   ├── lib/                  # Web-specific utilities
│   │   │   └── main.tsx
│   │   ├── .storybook/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── mobile/                       # React Native (Expo)
│   │   ├── app/                      # Expo Router file-based routes
│   │   └── package.json
│   │
│   └── api/                          # Rust Axum backend
│       ├── src/
│       │   ├── main.rs
│       │   ├── config.rs             # Environment config (envy crate)
│       │   ├── routes/               # Route handlers organized by domain
│       │   │   ├── mod.rs
│       │   │   ├── battery.rs
│       │   │   ├── trips.rs
│       │   │   ├── charging.rs
│       │   │   ├── efficiency.rs
│       │   │   ├── vehicles.rs
│       │   │   └── auth.rs
│       │   ├── db/                   # Database queries and pool
│       │   │   ├── mod.rs
│       │   │   ├── pool.rs
│       │   │   ├── battery.rs
│       │   │   ├── trips.rs
│       │   │   ├── charging.rs
│       │   │   └── efficiency.rs
│       │   ├── ingestion/            # Vehicle data collection
│       │   │   ├── mod.rs
│       │   │   ├── ws_client.rs      # Rivian WebSocket subscription manager
│       │   │   ├── poller.rs         # Adaptive polling state machine
│       │   │   ├── parser.rs         # GraphQL response → internal types
│       │   │   ├── trip_detector.rs  # Power state → trip boundary logic
│       │   │   └── session_store.rs  # Encrypted Rivian token storage
│       │   ├── middleware/
│       │   │   ├── auth.rs           # JWT validation middleware
│       │   │   ├── rate_limit.rs
│       │   │   └── request_id.rs
│       │   ├── models/               # Shared domain types
│       │   │   ├── mod.rs
│       │   │   ├── telemetry.rs
│       │   │   ├── trip.rs
│       │   │   ├── charge_session.rs
│       │   │   └── vehicle.rs
│       │   └── errors.rs             # AppError enum + IntoResponse impl
│       ├── migrations/               # sqlx migration files
│       │   ├── 0001_schema_init.sql
│       │   ├── 0002_telemetry_hypertable.sql
│       │   ├── 0003_continuous_aggregates.sql
│       │   ├── 0004_materialized_views.sql
│       │   └── 0005_indexes.sql
│       ├── tests/                    # Integration tests
│       │   ├── api/
│       │   │   ├── battery_test.rs
│       │   │   ├── trips_test.rs
│       │   │   └── charging_test.rs
│       │   └── ingestion/
│       │       ├── parser_test.rs
│       │       └── trip_detector_test.rs
│       └── Cargo.toml
│
├── packages/
│   ├── ui/                           # Shared component library
│   │   ├── src/
│   │   │   ├── tokens/               # Design tokens (source of truth)
│   │   │   │   ├── colors.ts
│   │   │   │   ├── typography.ts
│   │   │   │   ├── spacing.ts
│   │   │   │   └── index.ts
│   │   │   ├── charts/               # All chart components
│   │   │   │   ├── ChartProvider.tsx  # Theme context for all charts
│   │   │   │   ├── LineChart.tsx
│   │   │   │   ├── AreaChart.tsx
│   │   │   │   ├── BarChart.tsx
│   │   │   │   ├── ComposedChart.tsx
│   │   │   │   ├── GaugeChart.tsx
│   │   │   │   ├── PieChart.tsx
│   │   │   │   ├── ScatterChart.tsx
│   │   │   │   ├── ChargeCurveChart.tsx  # Specialized
│   │   │   │   ├── TripMapChart.tsx      # Maplibre-based
│   │   │   │   └── index.ts
│   │   │   ├── primitives/           # Base UI primitives
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── StatCard.tsx
│   │   │   │   ├── Badge.tsx
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Select.tsx
│   │   │   │   ├── DateRangePicker.tsx
│   │   │   │   ├── Skeleton.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   └── index.ts
│   │   │   ├── tables/               # TanStack Table wrappers
│   │   │   │   ├── DataTable.tsx
│   │   │   │   ├── columns/
│   │   │   │   │   ├── trips.tsx
│   │   │   │   │   └── charging.tsx
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── .storybook/
│   │   └── package.json
│   │
│   ├── hooks/                        # Shared React hooks
│   │   ├── src/
│   │   │   ├── useVehicleStatus.ts   # Live WS status
│   │   │   ├── useBattery.ts
│   │   │   ├── useTrips.ts
│   │   │   ├── useCharging.ts
│   │   │   ├── useEfficiency.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── types/                        # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── api.ts                # API response types (generated from OpenAPI)
│   │   │   ├── vehicle.ts
│   │   │   ├── telemetry.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── config/                       # Shared config (ESLint, TS, Tailwind base)
│       ├── eslint/
│       ├── typescript/
│       └── tailwind/
│           └── base.ts               # Shared Tailwind config with design tokens
│
├── infra/
│   ├── docker-compose.yml            # Local dev: Postgres/Timescale, Redis, MinIO
│   ├── docker-compose.prod.yml
│   ├── k8s/                          # Kubernetes Helm charts
│   └── grafana/
│       └── provisioning/
│           └── datasources/          # Pre-configured TimescaleDB data source
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Test, lint, type-check, audit
│       └── deploy.yml
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 4. Data Ingestion Architecture

### Overview

Data collection uses two channels operating concurrently per vehicle, managed by the Rust ingestion subsystem. The WebSocket connection is opened immediately on startup and held open. The poller runs independently on a timer driven by the vehicle's current `powerState`.

### Channel 1 — WebSocket Subscription (primary, event-driven)

**Endpoint:** `wss://api.rivian.com/gql-consumer-subscriptions/graphql`

**Connection lifecycle:**
1. Authenticate with Rivian (username + password → app session token + user session token + CSRF token)
2. Store tokens encrypted at rest using the `age` crate with a per-installation key
3. Open WebSocket connection with required headers: `a-sess`, `u-sess`, `csrf-token`
4. Send `connection_init` payload mimicking the Rivian Android app
5. Subscribe to `vehicleState` subscription with full field fragment
6. Receive pushed updates; parse, validate, and write to TimescaleDB
7. On disconnect: exponential backoff reconnect (1s, 2s, 4s, 8s, max 60s)
8. Token refresh: re-authenticate before token expiry (check every 6h)

**Fields captured from WebSocket:**

```
gnssLocation       { latitude, longitude, timeStamp }
gnssSpeed          { timeStamp, value }
gnssAltitude       { timeStamp, value }
batteryLevel       { timeStamp, value }         -- SOC 0-100
batteryCapacity    { timeStamp, value }         -- Wh (for health tracking)
distanceToEmpty    { timeStamp, value }         -- miles
powerState         { timeStamp, value }         -- sleep | ready | go | drive
chargerState       { timeStamp, value }         -- disconnected | connected | charging | done
chargerStatus      { timeStamp, value }
timeToEndOfCharge  { timeStamp, value }         -- minutes
batteryLimit       { timeStamp, value }         -- charge limit %
driveMode          { timeStamp, value }          -- sport | all-purpose | conserve | off-road
gearStatus         { timeStamp, value }
vehicleMileage     { timeStamp, value }         -- total odometer
cabinClimateInteriorTemperature { timeStamp, value }
cabinClimateDriverTemperature   { timeStamp, value }
batteryHvThermalEvent           { timeStamp, value }
twelveVoltBatteryHealth         { timeStamp, value }
```

**Important implementation note:** The HASS integration v1.3.7 explicitly removed all polling of vehicle state, switching entirely to WebSocket. Do not poll `GetVehicleState` — use only the subscription.

### Channel 2 — Adaptive Polling (supplemental, historical data)

**Endpoint:** `https://rivian.com/api/gql/gateway/graphql` (POST)

**Queries executed:**

| Query | Purpose | Frequency |
|-------|---------|-----------|
| `getCompletedSessionSummaries` | Charging history with kWh, timestamps | After every charging session ends |
| `GetVehicle` | Vehicle spec, trim, battery config | Once daily |
| `GetEstimatedRange` | Rivian's own range estimate model | Every 30 min when awake |
| `getWallboxStatus` | Home charger health | Every 30 min when home |

**Poll interval state machine** — driven by `powerState` from the WebSocket:

```
powerState = "drive"    → WS only; poll only getCompletedSessionSummaries at trip end
powerState = "charging" → poll every 30 seconds (getLiveSessionData during active charge)
powerState = "ready"    → poll every 5 minutes
powerState = "sleep"    → poll every 30 minutes
vehicleCloudConnection.isOnline = false → poll every 30 minutes (keep-alive only)
```

**Account safety rules (critical):**
- Never share primary Rivian account credentials. The onboarding flow must instruct users to create a dedicated sub-account (e.g. `user+rivianmate@domain.com`) and invite it as a driver.
- Never poll more aggressively than the intervals above.
- Always respect HTTP 429 responses with a minimum 5-minute backoff.
- Log all API calls with timestamps for debugging rate limit issues.

### Trip Detection Logic

Trip boundaries are detected by the ingest worker in `ingestion/trip_detector.rs`. No Rivian API provides explicit trip objects — we derive them.

**Trip start:** `powerState` transitions from `sleep` → `ready` OR `drive`, AND `gnssSpeed > 2 mph` within 60 seconds.

**Trip end:** `powerState` returns to `sleep`, OR `gnssSpeed = 0` for more than 5 consecutive minutes at a location more than 0.1 miles from trip start.

**On trip end, immediately compute and store:**
- `start_location` — first gnssLocation of trip
- `end_location` — last gnssLocation of trip
- `distance_miles` — summed haversine between consecutive GPS points
- `duration_seconds` — trip end ts - trip start ts
- `soc_start`, `soc_end` — batteryLevel at trip boundaries
- `efficiency_wh_per_mile` — `((soc_start - soc_end) / 100) × battery_capacity_wh / distance_miles`
- `drive_mode` — most frequent driveMode value during trip (mode of distribution)
- `max_speed_mph` — max gnssSpeed during trip

### Authentication Flow

```
User onboarding:
1. User enters dedicated Rivian sub-account email + password
2. Backend POSTs to Rivian login endpoint
3. If OTP required (2FA): prompt user for OTP code, complete auth
4. Receive: a-sess token, u-sess token, CSRF token
5. Encrypt token bundle with age (per-user key derived from installation secret)
6. Store encrypted blob in `vehicle_credentials` table
7. Open WebSocket connection immediately

Token refresh:
- Check token age every 6 hours
- Re-authenticate silently if tokens > 23 hours old
- On 401 from WebSocket: trigger immediate re-auth
```

---

## 5. Database Schema

### Migration 0001 — Base schema

```sql
-- Schema separation: rivianmate for app data, timeseries for telemetry
CREATE SCHEMA IF NOT EXISTS rivianmate;
CREATE SCHEMA IF NOT EXISTS timeseries;

-- Users
CREATE TABLE rivianmate.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- argon2id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vehicles
CREATE TABLE rivianmate.vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES rivianmate.users(id) ON DELETE CASCADE,
  rivian_vehicle_id TEXT NOT NULL,
  vin             TEXT,
  model           TEXT NOT NULL,        -- R1T | R1S
  trim            TEXT,                 -- Standard | Adventure | Launch
  color           TEXT,
  battery_config  TEXT,                 -- Standard | Large | Max
  battery_capacity_wh FLOAT8,          -- nominal Wh (from GetVehicle)
  home_latitude   FLOAT8,
  home_longitude  FLOAT8,
  name            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vehicle credentials (encrypted Rivian tokens)
CREATE TABLE rivianmate.vehicle_credentials (
  vehicle_id  UUID PRIMARY KEY REFERENCES rivianmate.vehicles(id) ON DELETE CASCADE,
  encrypted_tokens BYTEA NOT NULL,     -- age-encrypted JSON blob
  token_created_at TIMESTAMPTZ NOT NULL,
  last_refreshed_at TIMESTAMPTZ
);

-- Trips (summary rows, populated at trip end by trip_detector)
CREATE TABLE rivianmate.trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID NOT NULL REFERENCES rivianmate.vehicles(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  start_lat       FLOAT8,
  start_lng       FLOAT8,
  end_lat         FLOAT8,
  end_lng         FLOAT8,
  distance_miles  FLOAT8,
  duration_seconds INT,
  soc_start       FLOAT8,
  soc_end         FLOAT8,
  efficiency_wh_per_mile FLOAT8,
  max_speed_mph   FLOAT8,
  drive_mode      TEXT,
  outside_temp_c  FLOAT8,             -- optional, enriched from weather API later
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Charging sessions (populated from getCompletedSessionSummaries + charger_state transitions)
CREATE TABLE rivianmate.charge_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID NOT NULL REFERENCES rivianmate.vehicles(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  location_lat    FLOAT8,
  location_lng    FLOAT8,
  is_home         BOOLEAN,
  charger_type    TEXT,               -- AC | DC | DCFC
  kwh_added       FLOAT8,
  soc_start       FLOAT8,
  soc_end         FLOAT8,
  charge_limit    FLOAT8,
  max_charge_rate_kw FLOAT8,
  duration_minutes INT,
  cost_usd        FLOAT8,             -- nullable; computed from user rate × kWh
  rivian_session_id TEXT,             -- from Rivian API, for dedup
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User preferences
CREATE TABLE rivianmate.user_preferences (
  user_id         UUID PRIMARY KEY REFERENCES rivianmate.users(id) ON DELETE CASCADE,
  electricity_rate_per_kwh FLOAT8 DEFAULT 0.13,
  distance_unit   TEXT DEFAULT 'miles',    -- miles | km
  temperature_unit TEXT DEFAULT 'fahrenheit',
  home_timezone   TEXT DEFAULT 'America/Chicago',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Migration 0002 — Telemetry hypertable

```sql
-- Raw telemetry (every WebSocket event written here)
CREATE TABLE timeseries.telemetry (
  ts          TIMESTAMPTZ NOT NULL,
  vehicle_id  UUID NOT NULL,
  -- Location
  latitude    FLOAT8,
  longitude   FLOAT8,
  altitude_m  FLOAT8,
  speed_mph   FLOAT8,
  -- Battery
  battery_level      FLOAT8,    -- SOC 0–100
  battery_capacity_wh FLOAT8,
  distance_to_empty_mi FLOAT8,
  battery_limit      FLOAT8,
  -- State
  power_state        TEXT,
  charger_state      TEXT,
  charger_status     TEXT,
  time_to_end_of_charge_min INT,
  drive_mode         TEXT,
  gear_status        TEXT,
  -- Climate
  cabin_temp_c       FLOAT8,
  driver_temp_c      FLOAT8,
  -- Vehicle
  odometer_miles     FLOAT8,
  hv_thermal_event   TEXT,
  twelve_volt_health TEXT
);

-- Convert to TimescaleDB hypertable, partition by 1 week
SELECT create_hypertable('timeseries.telemetry', 'ts',
  chunk_time_interval => INTERVAL '1 week');

-- Compression policy: compress chunks older than 30 days
SELECT add_compression_policy('timeseries.telemetry',
  INTERVAL '30 days');

-- Index for common query patterns
CREATE INDEX ON timeseries.telemetry (vehicle_id, ts DESC);
CREATE INDEX ON timeseries.telemetry (vehicle_id, power_state, ts DESC);
```

### Migration 0003 — Continuous aggregates

```sql
-- 1-minute buckets (serves 24h and 7d chart views)
CREATE MATERIALIZED VIEW timeseries.telemetry_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', ts)   AS bucket,
  vehicle_id,
  avg(battery_level)            AS avg_soc,
  avg(distance_to_empty_mi)     AS avg_range_mi,
  avg(speed_mph)                AS avg_speed_mph,
  max(speed_mph)                AS max_speed_mph,
  avg(cabin_temp_c)             AS avg_cabin_temp_c,
  last(power_state, ts)         AS power_state,
  last(charger_state, ts)       AS charger_state,
  last(drive_mode, ts)          AS drive_mode,
  last(odometer_miles, ts)      AS odometer_miles,
  count(*)                      AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

-- Refresh policy: refresh last 2 hours every minute
SELECT add_continuous_aggregate_policy('timeseries.telemetry_1min',
  start_offset => INTERVAL '2 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

-- 1-hour buckets (serves 30d and 90d chart views)
CREATE MATERIALIZED VIEW timeseries.telemetry_1hr
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts)    AS bucket,
  vehicle_id,
  avg(battery_level)           AS avg_soc,
  min(battery_level)           AS min_soc,
  max(battery_level)           AS max_soc,
  avg(distance_to_empty_mi)    AS avg_range_mi,
  avg(speed_mph)               AS avg_speed_mph,
  max(speed_mph)               AS max_speed_mph,
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  max(battery_capacity_wh)     AS battery_capacity_wh,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('timeseries.telemetry_1hr',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- 1-day buckets (serves 1y+ chart views and battery health trend)
CREATE MATERIALIZED VIEW timeseries.telemetry_1day
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts)     AS bucket,
  vehicle_id,
  avg(battery_level)           AS avg_soc,
  min(battery_level)           AS min_soc,
  max(battery_level)           AS max_soc,
  avg(distance_to_empty_mi)    AS avg_range_mi,
  max(battery_capacity_wh)     AS battery_capacity_wh,   -- health indicator
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('timeseries.telemetry_1day',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');
```

### Migration 0004 — Materialized views for derived metrics

```sql
-- Phantom drain periods: parked segments with battery loss
CREATE MATERIALIZED VIEW timeseries.phantom_drain_periods AS
WITH parked_segments AS (
  SELECT
    vehicle_id,
    ts,
    battery_level,
    power_state,
    LAG(battery_level) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_soc,
    LAG(ts) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_ts
  FROM timeseries.telemetry
  WHERE power_state = 'sleep'
),
drain_events AS (
  SELECT
    vehicle_id,
    ts               AS period_end,
    prev_ts          AS period_start,
    prev_soc         AS soc_start,
    battery_level    AS soc_end,
    (prev_soc - battery_level) AS soc_lost,
    EXTRACT(EPOCH FROM (ts - prev_ts)) / 3600.0 AS hours_elapsed
  FROM parked_segments
  WHERE prev_soc IS NOT NULL
    AND (prev_soc - battery_level) > 0
    AND EXTRACT(EPOCH FROM (ts - prev_ts)) > 300  -- min 5 min gap
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  soc_lost,
  hours_elapsed,
  (soc_lost / NULLIF(hours_elapsed, 0)) AS drain_rate_soc_per_hour
FROM drain_events;

CREATE UNIQUE INDEX ON timeseries.phantom_drain_periods (vehicle_id, period_start);

-- Daily phantom drain summary
CREATE MATERIALIZED VIEW timeseries.phantom_drain_daily AS
SELECT
  date_trunc('day', period_start) AS day,
  vehicle_id,
  sum(soc_lost)                   AS total_soc_lost,
  sum(hours_elapsed)              AS total_hours_parked,
  avg(drain_rate_soc_per_hour)    AS avg_drain_rate,
  count(*)                        AS drain_events
FROM timeseries.phantom_drain_periods
GROUP BY 1, 2;

CREATE UNIQUE INDEX ON timeseries.phantom_drain_daily (vehicle_id, day);
```

---

## 6. Metric Computation Strategy

**Rule:** Never compute a metric in application code (Rust or TypeScript) that the database can compute. Never ship raw rows to the client and aggregate in the browser.

### Where each metric lives

| Metric | Computed by | Notes |
|--------|-------------|-------|
| SOC over time | `telemetry_1min` / `_1hr` / `_1day` agg | Resolution selected by API based on date range |
| Range estimate trend | Same continuous agg tables | `avg_range_mi` column |
| Battery capacity health | `telemetry_1day.battery_capacity_wh` | Daily max shows degradation trend |
| Phantom drain rate | `phantom_drain_daily` materialized view | Pre-computed, refreshed daily |
| Trip list & summaries | `rivianmate.trips` table | Written at trip close by ingest worker |
| Trip GPS track | Raw `timeseries.telemetry` rows for trip window | Downsampled with `time_bucket('5 sec')` for long trips |
| Speed profile | `telemetry_1min` filtered to trip window | |
| Elevation profile | Raw telemetry, `time_bucket('10 sec')` | |
| Trip efficiency | `trips.efficiency_wh_per_mile` | Computed once at trip close; stored |
| Charging session list | `rivianmate.charge_sessions` | Written from Rivian poll + charger_state transitions |
| kWh added | `charge_sessions.kwh_added` | From Rivian `getCompletedSessionSummaries` |
| Charge curve (kW over time) | Derived in API layer | `Δbattery_capacity_wh × Δsoc / Δt` per minute during session |
| Cost per session | Rust API handler | `kwh_added × user_preferences.electricity_rate_per_kwh` |
| Home vs away flag | Rust API handler | Haversine distance from `vehicles.home_lat/lng` |
| Efficiency by drive mode | SQL `GROUP BY drive_mode` over trips | Single query; returns {mode, avg_wh_per_mile, trip_count} |
| Range vs temperature | SQL join + bucket | Trips joined to `avg_cabin_temp_c`, bucketed by 5°F bins |
| Lifetime efficiency | SQL avg over all trips | Indexed; fast |
| Summary totals (miles, kWh, cost) | SQL SUM over trips + charge_sessions | Single endpoint, cached 5 min |
| Current status (SOC, range, state) | WebSocket → Zustand → React | No API call; live from WS stream |

### API resolution selection

The API automatically selects the appropriate pre-aggregated table based on the requested date range:

```
Range ≤ 48 hours  → timeseries.telemetry_1min    (~2,880 data points max)
Range ≤ 90 days   → timeseries.telemetry_1hr     (~2,160 data points max)
Range > 90 days   → timeseries.telemetry_1day    (~365 data points max)
```

The client passes `?from=ISO8601&to=ISO8601` and never specifies resolution — the API chooses it. This keeps charts responsive regardless of zoom level.

---

## 7. Backend — Rust API

### Route inventory

```
GET  /health                              # Health check (no auth)
POST /auth/register                       # Create account
POST /auth/login                          # Get JWT
POST /auth/logout

POST /vehicles                            # Add vehicle (triggers Rivian auth flow)
GET  /vehicles                            # List user's vehicles
GET  /vehicles/:id/status                 # Current live status (from Redis cache of WS data)

GET  /v1/battery/soc?from&to             # SOC over time (resolution auto-selected)
GET  /v1/battery/range?from&to           # Range estimate over time
GET  /v1/battery/capacity?from&to        # Battery capacity health trend
GET  /v1/battery/phantom-drain?from&to   # Phantom drain daily summary

GET  /v1/trips?from&to&limit&offset      # Paginated trip list
GET  /v1/trips/:id                        # Trip detail
GET  /v1/trips/:id/track                  # GPS track (downsampled points array)
GET  /v1/trips/:id/speed                  # Speed profile
GET  /v1/trips/:id/elevation             # Elevation profile

GET  /v1/charging/sessions?from&to&limit&offset
GET  /v1/charging/sessions/:id           # Session detail + charge curve
GET  /v1/charging/summary?from&to        # Aggregated charging stats

GET  /v1/efficiency/summary?from&to      # Overall efficiency metrics
GET  /v1/efficiency/by-mode?from&to      # Grouped by drive mode
GET  /v1/efficiency/range-vs-temp?from&to

GET  /v1/stats/summary                   # Dashboard summary cards (totals)

# Grafana-compatible data source endpoints (API key auth, not JWT)
GET  /grafana/query                       # Grafana SimpleJSON protocol
GET  /grafana/search                      # Available metrics
```

### Error handling

All errors use a unified `AppError` enum that implements `IntoResponse`:

```rust
// src/errors.rs
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found")]
    NotFound,
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Forbidden")]
    Forbidden,
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Rivian API error: {0}")]
    RivianApi(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Internal error")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound      => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
            AppError::Unauthorized  => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            AppError::Forbidden     => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            AppError::Validation(m) => (StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION", m.clone()),
            _                       => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", "Internal server error".into()),
        };
        let body = json!({ "error": { "code": code, "message": message } });
        (status, Json(body)).into_response()
    }
}
```

---

## 8. Brand & Design Token System

> **For the agent:** The token system is the single source of truth for all visual decisions. Every color, font size, spacing value, border radius, and animation duration used anywhere in the UI must reference a token. Never hardcode a hex value or pixel count in a component. The token file is at `packages/ui/src/tokens/index.ts` and is consumed by `packages/config/tailwind/base.ts`.

### Color Palette

RivianMate uses a dark-first palette inspired by Rivian's own aesthetic — deep slate backgrounds, a distinctive electric green primary, and amber for warnings/charging states.

```typescript
// packages/ui/src/tokens/colors.ts
export const colors = {
  // Brand primaries
  brand: {
    green: {
      50:  '#EDFDF4',
      100: '#D1FAE5',
      200: '#A7F3D0',
      400: '#34D399',
      500: '#10B981',   // PRIMARY — main CTAs, active states, charged indicators
      600: '#059669',
      700: '#047857',
      800: '#065F46',
      900: '#064E3B',
    },
    slate: {
      50:  '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',   // Surface / card background
      900: '#0F172A',   // Page background (dark mode)
      950: '#020617',   // Deepest background
    },
  },

  // Semantic — charging & energy states
  charging: {
    active:  '#F59E0B',   // Amber — actively charging
    done:    '#10B981',   // Green — charge complete
    limited: '#EF4444',   // Red — thermal limit / issue
    ac:      '#60A5FA',   // Blue — AC charging
    dc:      '#A78BFA',   // Purple — DC fast charging
  },

  // Semantic — battery SOC
  soc: {
    high:    '#10B981',   // > 60%
    mid:     '#F59E0B',   // 20–60%
    low:     '#EF4444',   // < 20%
  },

  // Data visualization palette (for charts — 8 distinct colors)
  // Use in order; these are designed for dark backgrounds
  dataViz: [
    '#10B981',   // green (primary)
    '#60A5FA',   // blue
    '#F59E0B',   // amber
    '#A78BFA',   // purple
    '#F87171',   // red
    '#34D399',   // teal
    '#FB923C',   // orange
    '#818CF8',   // indigo
  ],

  // Neutral text and borders (same in light/dark via CSS variables)
  text: {
    primary:   'var(--rm-text-primary)',
    secondary: 'var(--rm-text-secondary)',
    tertiary:  'var(--rm-text-tertiary)',
    disabled:  'var(--rm-text-disabled)',
  },
  bg: {
    page:    'var(--rm-bg-page)',
    surface: 'var(--rm-bg-surface)',
    elevated:'var(--rm-bg-elevated)',
    overlay: 'var(--rm-bg-overlay)',
  },
  border: {
    default: 'var(--rm-border-default)',
    strong:  'var(--rm-border-strong)',
    focus:   '#10B981',
  },
} as const;
```

### CSS Custom Properties (injected at :root)

```css
/* packages/ui/src/tokens/globals.css */
:root {
  /* Light mode */
  --rm-text-primary:   #0F172A;
  --rm-text-secondary: #475569;
  --rm-text-tertiary:  #94A3B8;
  --rm-text-disabled:  #CBD5E1;
  --rm-bg-page:        #F8FAFC;
  --rm-bg-surface:     #FFFFFF;
  --rm-bg-elevated:    #F1F5F9;
  --rm-bg-overlay:     rgba(15, 23, 42, 0.5);
  --rm-border-default: #E2E8F0;
  --rm-border-strong:  #CBD5E1;
}

.dark {
  --rm-text-primary:   #F1F5F9;
  --rm-text-secondary: #94A3B8;
  --rm-text-tertiary:  #475569;
  --rm-text-disabled:  #334155;
  --rm-bg-page:        #020617;
  --rm-bg-surface:     #0F172A;
  --rm-bg-elevated:    #1E293B;
  --rm-bg-overlay:     rgba(0, 0, 0, 0.7);
  --rm-border-default: #1E293B;
  --rm-border-strong:  #334155;
}
```

### Typography Tokens

```typescript
// packages/ui/src/tokens/typography.ts
export const typography = {
  fonts: {
    sans:  '"Inter Variable", system-ui, sans-serif',
    mono:  '"JetBrains Mono Variable", "Fira Code", monospace',
  },
  sizes: {
    xs:   '0.75rem',    // 12px — captions, labels
    sm:   '0.875rem',   // 14px — secondary text, table cells
    base: '1rem',       // 16px — body
    lg:   '1.125rem',   // 18px — card titles
    xl:   '1.25rem',    // 20px — section headings
    '2xl':'1.5rem',     // 24px — page headings
    '3xl':'1.875rem',   // 30px — hero stat numbers
    '4xl':'2.25rem',    // 36px — large stat display
  },
  weights: {
    normal:   '400',
    medium:   '500',
    semibold: '600',
    bold:     '700',
  },
  lineHeights: {
    tight:  '1.25',
    normal: '1.5',
    relaxed:'1.75',
  },
  // Numeric display: tabular figures for aligned data columns
  numericVariant: '"tnum"',   // font-variant-numeric: tabular-nums
} as const;
```

### Spacing & Layout Tokens

```typescript
// packages/ui/src/tokens/spacing.ts
export const spacing = {
  // Base 4px grid
  0.5: '0.125rem',  // 2px
  1:   '0.25rem',   // 4px
  2:   '0.5rem',    // 8px
  3:   '0.75rem',   // 12px
  4:   '1rem',      // 16px
  5:   '1.25rem',   // 20px
  6:   '1.5rem',    // 24px
  8:   '2rem',      // 32px
  10:  '2.5rem',    // 40px
  12:  '3rem',      // 48px
  16:  '4rem',      // 64px
  20:  '5rem',      // 80px
} as const;

export const layout = {
  borderRadius: {
    sm:   '0.25rem',   // 4px — badges, small pills
    md:   '0.5rem',    // 8px — inputs, buttons
    lg:   '0.75rem',   // 12px — cards
    xl:   '1rem',      // 16px — large cards, modals
    full: '9999px',    // pills
  },
  shadows: {
    // Dark-friendly shadows (subtle, not harsh)
    sm:  '0 1px 2px rgba(0,0,0,0.3)',
    md:  '0 4px 6px rgba(0,0,0,0.4)',
    lg:  '0 10px 15px rgba(0,0,0,0.4)',
  },
  chartHeight: {
    compact: 200,   // px — sparklines, mini charts
    default: 320,   // px — standard dashboard charts
    tall:    480,   // px — detail page full charts
    full:    640,   // px — trip map, feature charts
  },
} as const;
```

### Tailwind Configuration

```typescript
// packages/config/tailwind/base.ts
import { colors, typography, spacing, layout } from '@rivianmate/ui/tokens';

export const tailwindBase = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand:    colors.brand,
        charging: colors.charging,
        soc:      colors.soc,
        surface:  {
          page:    'var(--rm-bg-page)',
          default: 'var(--rm-bg-surface)',
          elevated:'var(--rm-bg-elevated)',
        },
        border: {
          default: 'var(--rm-border-default)',
          strong:  'var(--rm-border-strong)',
        },
        text: {
          primary:   'var(--rm-text-primary)',
          secondary: 'var(--rm-text-secondary)',
          tertiary:  'var(--rm-text-tertiary)',
        },
      },
      fontFamily: {
        sans: typography.fonts.sans.split(', '),
        mono: typography.fonts.mono.split(', '),
      },
      borderRadius: layout.borderRadius,
      boxShadow:    layout.shadows,
    },
  },
} satisfies Partial<Config>;
```

---

## 9. Chart System — Modular & Tokenized

> **For the agent:** Every chart in the application must use a component from `packages/ui/src/charts/`. Never build one-off chart configurations in page components. All charts share a `ChartProvider` context that injects the brand theme into Recharts. The chart components accept domain-specific props, not raw Recharts props.

### ChartProvider — Theme injection

```tsx
// packages/ui/src/charts/ChartProvider.tsx
import React, { createContext, useContext } from 'react';
import { colors, typography, layout } from '../tokens';

export interface ChartTheme {
  colors:        string[];          // dataViz palette
  backgroundColor: string;
  gridColor:     string;
  axisColor:     string;
  tickColor:     string;
  tooltipBg:     string;
  tooltipBorder: string;
  fontFamily:    string;
  fontSize:      number;            // 12
  animationDuration: number;        // ms
}

const defaultTheme: ChartTheme = {
  colors:          colors.dataViz,
  backgroundColor: 'transparent',
  gridColor:       'rgba(148, 163, 184, 0.12)',   // slate-400 at low opacity
  axisColor:       'rgba(148, 163, 184, 0.3)',
  tickColor:       '#64748B',
  tooltipBg:       '#1E293B',
  tooltipBorder:   '#334155',
  fontFamily:      typography.fonts.sans,
  fontSize:        12,
  animationDuration: 600,
};

const ChartThemeContext = createContext<ChartTheme>(defaultTheme);
export const useChartTheme = () => useContext(ChartThemeContext);

export function ChartProvider({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme?: Partial<ChartTheme>;
}) {
  return (
    <ChartThemeContext.Provider value={{ ...defaultTheme, ...theme }}>
      {children}
    </ChartThemeContext.Provider>
  );
}
```

### Shared chart props interface

```typescript
// All chart components extend this base
export interface BaseChartProps {
  height?:      number;                  // default: layout.chartHeight.default (320)
  loading?:     boolean;
  error?:       string | null;
  emptyMessage?: string;
  className?:  string;
  // Date range (drives API refetch via parent hook)
  from?:        Date;
  to?:          Date;
}
```

### Chart component catalogue

#### LineChart / AreaChart

Used for: SOC over time, range trend, odometer trend.

```tsx
// packages/ui/src/charts/AreaChart.tsx
interface AreaChartProps extends BaseChartProps {
  data:       Array<{ ts: string; value: number }>;
  dataKey:    string;           // 'value'
  label:      string;           // Y-axis label, e.g. "State of charge (%)"
  color?:     string;           // defaults to colors.dataViz[0]
  unit?:      string;           // appended to tooltip value
  domain?:    [number, number]; // Y-axis domain; defaults to ['auto','auto']
  threshold?: {                 // optional colored band (e.g. low SOC warning zone)
    value: number;
    color: string;
    label: string;
  };
  showDots?:  boolean;          // default false; true for sparse data
}
```

Visual specification:
- Area fill: `color` at 15% opacity
- Line stroke: `color` at 100%, 2px width
- Grid: horizontal only, `gridColor` from theme
- Axes: clean, no axis lines (only ticks)
- Tooltip: dark card with vehicle green accent, shows exact value + formatted timestamp
- Animation: ease-out, 600ms on mount

#### GaugeChart

Used for: Current SOC, charge level display, battery health percentage.

```tsx
interface GaugeChartProps extends BaseChartProps {
  value:       number;          // 0–100
  max?:        number;          // default 100
  label:       string;          // center label, e.g. "State of charge"
  unit?:       string;          // e.g. "%" or "mi"
  colorFn?:    (value: number) => string;  // default: SOC color ramp
  size?:       'sm' | 'md' | 'lg';        // controls SVG diameter
  showValue?:  boolean;         // default true — show number in center
  animate?:    boolean;         // default true — sweep animation on mount
}
```

Implementation: SVG arc (not Recharts). D3 `arc` generator. Sweep from 7 o'clock position, clockwise. Track: `gridColor`. Fill: dynamic via `colorFn`. Center number: `typography.sizes['4xl']`, bold, tabular nums.

#### BarChart

Used for: Charging sessions per week, efficiency by drive mode, phantom drain by day.

```tsx
interface BarChartProps extends BaseChartProps {
  data:        Array<Record<string, unknown>>;
  xKey:        string;          // category axis key
  bars:        Array<{
    dataKey: string;
    label:   string;
    color?:  string;            // sequential from dataViz palette
  }>;
  stacked?:    boolean;
  layout?:     'vertical' | 'horizontal';  // default horizontal
  showValues?: boolean;         // show value labels on bars
}
```

#### PieChart / DonutChart

Used for: Home vs away charging breakdown, drive mode distribution, charging type split (AC/DC/DCFC).

```tsx
interface DonutChartProps extends BaseChartProps {
  data: Array<{
    label:  string;
    value:  number;
    color?: string;   // sequential from dataViz if not provided
  }>;
  innerRadius?: number;   // 0 = pie, >0 = donut. Default 60 (donut).
  showLegend?:  boolean;  // default true; legend to the right
  showTooltip?: boolean;
  centerLabel?: string;   // text in donut center (e.g. total kWh)
  centerValue?: string;
}
```

#### ScatterChart

Used for: Range vs temperature correlation.

```tsx
interface ScatterChartProps extends BaseChartProps {
  data:   Array<{ x: number; y: number; label?: string }>;
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  color?: string;
  showTrendLine?: boolean;   // simple linear regression overlay
}
```

Trend line: computed client-side (simple linear regression from `data` — this is the one exception to "no client-side math" because it's purely a rendering decoration on already-aggregated scatter points).

#### ChargeCurveChart

Specialized composite chart for charging session detail. Dual Y-axis: kW charge rate (left, amber) + SOC% (right, green). X-axis: time since session start (minutes).

```tsx
interface ChargeCurveChartProps extends BaseChartProps {
  data: Array<{
    minutes:      number;
    charge_rate_kw: number;
    soc:          number;
  }>;
  sessionSummary: {
    kwh_added:    number;
    duration_min: number;
    max_kw:       number;
  };
}
```

#### TripMapChart

Maplibre GL JS map with GPS track overlay. Color-codes the track by speed using a green→amber→red scale.

```tsx
interface TripMapChartProps extends BaseChartProps {
  track: Array<{
    lat:   number;
    lng:   number;
    speed_mph: number;
    ts:    string;
  }>;
  startLocation: { lat: number; lng: number };
  endLocation:   { lat: number; lng: number };
  style?:        'dark' | 'satellite';   // default: 'dark'
}
```

Map tiles: Protomaps (self-hosted) or `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (public, no key required).

### StatCard component

Used for dashboard summary numbers. Not a chart — a primitive display component.

```tsx
interface StatCardProps {
  label:      string;
  value:      string | number;
  unit?:      string;
  delta?:     { value: number; label: string; direction: 'up' | 'down' | 'neutral' };
  icon?:      React.ReactNode;
  loading?:   boolean;
  color?:     'default' | 'green' | 'amber' | 'blue' | 'red';
  size?:      'sm' | 'md' | 'lg';
}
```

Design: dark surface card (`bg-surface-elevated`), subtle border, label in `text-secondary`, value in `text-4xl font-bold tabular-nums`, unit in `text-secondary text-lg`. Delta shows colored arrow and percentage.

### Shared tooltip component

All Recharts charts use a shared `<ChartTooltip />` component for visual consistency:

```tsx
// packages/ui/src/charts/ChartTooltip.tsx
interface ChartTooltipProps {
  active?:   boolean;
  payload?:  Array<{ name: string; value: number; unit?: string; color: string }>;
  label?:    string;     // formatted timestamp or category
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, name: string) => string;
}
```

Appearance: `bg-surface-elevated border border-border-strong rounded-lg shadow-lg p-3`. Each series shown as colored dot + label + bold value.

### Shared Skeleton / Loading states

Every chart component renders `<ChartSkeleton height={height} />` while `loading === true`. This is an animated pulse placeholder the same dimensions as the chart, preventing layout shift.

---

## 10. Frontend Architecture

### Data flow pattern

```
Rivian API
  → WebSocket → Zustand store (live vehicle status)
                   → useVehicleStatus() hook → StatusBar, StatCards

  → REST API  → React Query cache
                   → useBattery(dateRange) → BatteryPage charts
                   → useTrips(filters) → TripsPage table + TripDetail
                   → useCharging(filters) → ChargingPage
                   → useEfficiency(dateRange) → EfficiencyPage
```

### Hook conventions

All data hooks in `packages/hooks/src/` follow this pattern:

```typescript
// packages/hooks/src/useBattery.ts
export function useBattery(vehicleId: string, range: DateRange) {
  const socQuery = useQuery({
    queryKey: ['battery', 'soc', vehicleId, range.from, range.to],
    queryFn:  () => api.battery.getSoc(vehicleId, range),
    staleTime: 60_000,    // 1 min
    gcTime:    300_000,   // 5 min
  });

  const rangeQuery = useQuery({
    queryKey: ['battery', 'range', vehicleId, range.from, range.to],
    queryFn:  () => api.battery.getRange(vehicleId, range),
    staleTime: 60_000,
  });

  const phantomDrainQuery = useQuery({ ... });

  return {
    soc:         socQuery,
    range:       rangeQuery,
    phantomDrain: phantomDrainQuery,
    isLoading:   socQuery.isLoading || rangeQuery.isLoading,
    isError:     socQuery.isError || rangeQuery.isError,
  };
}
```

### WebSocket live status store

```typescript
// packages/hooks/src/useVehicleStatus.ts
// Connects to our backend WS proxy (not directly to Rivian)
// Our backend holds the Rivian WS connection and fans data to authenticated clients

interface VehicleStatus {
  vehicleId:       string;
  batteryLevel:    number;
  distanceToEmpty: number;
  powerState:      'sleep' | 'ready' | 'drive' | 'charging';
  chargerState:    'disconnected' | 'connected' | 'charging' | 'done';
  chargerStatus:   string;
  speed:           number;
  location:        { lat: number; lng: number } | null;
  lastUpdated:     Date;
  isOnline:        boolean;
}

// Zustand store
export const useVehicleStatusStore = create<VehicleStatusStore>(...)

// Hook with WS connection
export function useVehicleStatus(vehicleId: string): VehicleStatus { ... }
```

### Page layout system

All pages use a shared layout:

```tsx
// Standard page wrapper
<PageLayout
  title="Battery"
  subtitle="State of charge, range, and health over time"
  headerRight={<DateRangePicker value={range} onChange={setRange} />}
>
  <StatCardGrid>
    <StatCard label="Current SOC" value={currentSoc} unit="%" ... />
    ...
  </StatCardGrid>

  <ChartSection title="State of charge over time">
    <AreaChart data={soc.data} ... />
  </ChartSection>

  <ChartSection title="Estimated range">
    <AreaChart data={range.data} ... />
  </ChartSection>
</PageLayout>
```

---

## 11. Dashboard & Page Inventory

Each page maps to TeslaMATE equivalents. Build these in order (see Section 16).

### Home dashboard

Summary cards: current SOC, range, odometer, total trips, total charging sessions, lifetime efficiency. Live vehicle status widget (power state, charger state, location).

### Battery page (`/battery`)

**Charts:**
- SOC over time — `AreaChart` — primary feature chart
- Estimated range trend — `AreaChart` — shows model accuracy degradation
- Battery capacity health — `AreaChart` (daily max, long-term) — health trend
- Phantom drain — `BarChart` (daily SOC loss while parked)
- Current SOC — `GaugeChart` (live from WS)

**TeslaMATE equivalents:** "Charging Stats", "Battery Health", "Vampire Drain"

### Trips page (`/trips`)

**Table:** `DataTable` with columns: date, start/end location, distance, duration, efficiency (Wh/mi), drive mode, start SOC → end SOC. Sortable by all columns. Click row → trip detail.

**Trip detail (`/trips/:id`):**
- `TripMapChart` — full-width GPS track with speed color coding
- `AreaChart` — speed profile
- `AreaChart` — elevation profile
- Stat cards: distance, duration, efficiency, max speed, start/end SOC

**TeslaMATE equivalents:** "Drives" table, drive detail view

### Charging page (`/charging`)

**Charts:**
- Sessions table — `DataTable`: date, location, kWh added, duration, cost, charger type, home/away flag
- kWh added per week — `BarChart`
- Home vs away split — `DonutChart`
- AC vs DC vs DCFC split — `DonutChart`
- Top charging locations — ranked list with map markers

**Session detail (`/charging/:id`):**
- `ChargeCurveChart` — charge rate + SOC over time during session
- Stat cards: total kWh, duration, cost, max kW, charger type

**TeslaMATE equivalents:** "Charges", charging detail

### Efficiency page (`/efficiency`)

**Charts:**
- Efficiency trend over time — `AreaChart` (Wh/mi, 30-day rolling avg overlay)
- Efficiency by drive mode — `BarChart` (grouped)
- Range vs outside temperature — `ScatterChart` with trend line
- Efficiency distribution — `BarChart` (histogram of Wh/mi across all trips)

**TeslaMATE equivalents:** "Efficiency" dashboard

### Settings page (`/settings`)

- Vehicle management (add/remove vehicle, set home location)
- Electricity rate ($/kWh) for cost calculations
- Display preferences (miles/km, °F/°C)
- Grafana API key management
- Data export (CSV, GPX)

---

## 12. Testing Strategy

> **For the agent:** Tests are not optional. Every module requires tests before moving to the next. CI blocks merges on test failure, clippy warnings (Rust), or TypeScript errors.

### Rust backend testing

**Unit tests** (in each source file via `#[cfg(test)]`):
- `ingestion/parser.rs` — test every known Rivian field shape; use `proptest` for malformed inputs
- `ingestion/trip_detector.rs` — test all powerState transition sequences
- `ingestion/poller.rs` — test interval selection for each powerState
- `routes/*.rs` — test query parameter parsing and validation
- `db/*.rs` — test SQL query construction (compile-time via sqlx)

**Integration tests** (`tests/` directory):
- Use `testcontainers` to spin up real TimescaleDB
- Run all migrations against test container
- Seed known telemetry data
- Assert API responses match expected shapes and values
- Test auth middleware rejects invalid JWTs
- Test rate limiting triggers correctly

**Property tests** (`proptest`):
- Fuzz `parser.rs` with arbitrary JSON shapes — must never panic
- Fuzz `trip_detector.rs` with arbitrary powerState sequences

**CI commands:**
```bash
cargo test                    # All tests
cargo clippy -- -D warnings   # Fail on any warning
cargo audit                   # Check for vulnerable dependencies
```

### Frontend testing

**Unit tests** (Vitest):
- All token exports are correctly typed and non-empty
- All chart prop interfaces satisfy TypeScript strict mode
- Hook data transformation functions (date formatting, unit conversion)
- Utility functions (haversine, efficiency calculation for display)

**Component tests** (Vitest + React Testing Library):
- Every component in `packages/ui/` has a test file
- Test: renders without crashing, renders loading state, renders error state, renders empty state, renders with realistic data
- Test: StatCard renders correct value and unit
- Test: GaugeChart renders at correct fill for given value
- Test: DataTable renders correct number of rows, sort changes order

**E2E tests** (Playwright):
- Full auth flow (register → login → add vehicle)
- Battery page loads and shows charts
- Trips page shows table; click row navigates to detail
- Charging page loads sessions
- Date range picker updates all charts on page
- Dark mode toggle persists across navigation

**Test data:** Maintain a `fixtures/` directory in each test suite with realistic but anonymized vehicle data. The fixture set covers: normal driving day, long road trip, DC fast charge session, phantom drain overnight, full charge cycle.

---

## 13. Storybook Structure

> **For the agent:** Every component in `packages/ui/` must have a corresponding Story. Storybook is the living design system documentation and the primary way to develop components in isolation before integrating them into pages.

### Story organization

```
packages/ui/.storybook/
├── main.ts
├── preview.ts               # Inject ChartProvider, dark mode toggle, token globals
└── stories/
    ├── tokens/
    │   ├── Colors.stories.tsx      # Visual palette reference
    │   └── Typography.stories.tsx
    ├── primitives/
    │   ├── StatCard.stories.tsx
    │   ├── Badge.stories.tsx
    │   ├── Button.stories.tsx
    │   └── Skeleton.stories.tsx
    ├── charts/
    │   ├── AreaChart.stories.tsx
    │   ├── GaugeChart.stories.tsx
    │   ├── BarChart.stories.tsx
    │   ├── DonutChart.stories.tsx
    │   ├── ScatterChart.stories.tsx
    │   ├── ChargeCurveChart.stories.tsx
    │   └── TripMapChart.stories.tsx
    └── tables/
        ├── TripsTable.stories.tsx
        └── ChargingTable.stories.tsx
```

### Required stories per chart component

Each chart story file must include:
- `Default` — realistic data, default props
- `Loading` — `loading={true}`
- `Empty` — empty data array
- `Error` — `error="Failed to load data"`
- `DarkMode` — wrapped with `.dark` class
- `Compact` — `height={layout.chartHeight.compact}`
- `Tall` — `height={layout.chartHeight.tall}`
- Any component-specific variants (e.g. GaugeChart: `LowSoc`, `Charging`, `Full`)

---

## 14. Infrastructure & DevOps

### Docker Compose (local dev)

```yaml
# infra/docker-compose.yml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: rivianmate
      POSTGRES_USER: rivianmate
      POSTGRES_PASSWORD: devpassword
    ports: ["5432:5432"]
    volumes: ["timescaledb_data:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile.dev
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: postgresql://rivianmate:devpassword@timescaledb:5432/rivianmate
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-change-in-prod
    depends_on: [timescaledb, redis]
    volumes: ["./apps/api:/app"]

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile.dev
    ports: ["3000:3000"]
    environment:
      VITE_API_URL: http://localhost:3001
    volumes: ["./apps/web:/app"]
```

### Environment variables

```bash
# apps/api/.env.example
DATABASE_URL=postgresql://rivianmate:password@localhost:5432/rivianmate
REDIS_URL=redis://localhost:6379
JWT_SECRET=                    # RS256 private key (generate with openssl)
JWT_PUBLIC_KEY=                # RS256 public key
AGE_ENCRYPTION_KEY=            # age key for Rivian token encryption
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
RUST_LOG=rivianmate=debug,tower_http=info
```

### CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  rust:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: timescale/timescaledb:latest-pg16
        env: { POSTGRES_PASSWORD: testpass, POSTGRES_DB: rivianmate_test }
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo clippy -- -D warnings
      - run: cargo test
      - run: cargo audit

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo typecheck lint test
      - run: pnpm turbo build
```

---

## 15. Security Requirements

These are mandatory, not optional. Implement before any feature is considered complete.

**Authentication:**
- All `/v1/*` endpoints require valid JWT (RS256, 15-minute expiry + refresh token)
- Row-level security: every query must filter by `vehicle_id` where `vehicle.user_id = authenticated_user_id`
- Never return data from another user's vehicle under any circumstances

**Rivian credential storage:**
- Encrypt Rivian tokens at rest using `age` with a per-installation key
- Never log Rivian tokens, session IDs, or credentials
- Store minimum required credentials (session tokens only, never plain password)

**API hardening:**
- Rate limiting: 100 req/min per user on data endpoints, 10 req/min on auth endpoints
- CORS: restrict to configured allowed origins only
- Request body size limit: 64KB max
- SQL injection prevention: sqlx compile-time query checking; never string-interpolate SQL
- Helmet-equivalent headers via `tower-http`: CSP, HSTS, X-Frame-Options, X-Content-Type-Options

**Grafana endpoints:**
- Separate API key authentication (not JWT)
- Read-only: no mutations permitted on Grafana endpoints
- Scoped to a single vehicle (API key bound to vehicle at creation)

---

## 16. Build Order & Agent Instructions

> **For the agent:** Build in this exact order. Do not skip ahead. Each phase must have passing tests before beginning the next.

### Phase 1 — Infrastructure & skeleton (start here)

1. Initialize pnpm monorepo with `pnpm-workspace.yaml` and `turbo.json`
2. Create `packages/config` with shared ESLint, TypeScript (strict), and Tailwind base config
3. Create `packages/types/src/` with all TypeScript interfaces defined in this document
4. Set up `infra/docker-compose.yml` — verify TimescaleDB starts and accepts connections
5. Initialize Rust workspace at `apps/api/` with all crate dependencies in `Cargo.toml`
6. Write all database migrations (0001–0005) in `apps/api/migrations/`
7. Run `sqlx migrate run` — verify all migrations apply cleanly
8. Implement `AppError` and health check endpoint (`GET /health`)
9. Write one integration test that spins up the test container and hits `/health`
10. **Gate:** `cargo test` passes, `cargo clippy` clean

### Phase 2 — Design token system & Storybook

1. Create `packages/ui/src/tokens/` — all token files as specified in Section 8
2. Set up `packages/ui/.storybook/` with dark mode toggle and token globals injected
3. Create `Colors.stories.tsx` and `Typography.stories.tsx` as visual reference
4. Implement all `packages/ui/src/primitives/` components with stories
5. Implement `ChartProvider` and `ChartTheme` context
6. Implement `StatCard` with all variants and stories
7. Implement `Skeleton` / `EmptyState` / `ChartSkeleton`
8. **Gate:** Storybook builds without errors; all primitive stories render

### Phase 3 — Chart components

Build each chart component with its story file before moving to the next:

1. `AreaChart` + stories (Default, Loading, Empty, DarkMode, Compact, Tall)
2. `GaugeChart` + stories (Default, LowSoc, Charging, Full, Loading)
3. `BarChart` + stories (Horizontal, Vertical, Stacked, Loading)
4. `DonutChart` + stories (Default, Pie, WithCenter, Loading)
5. `ScatterChart` + stories (Default, WithTrendLine, Loading)
6. `ChargeCurveChart` + stories
7. `TripMapChart` + stories (Static track, Loading)
8. **Gate:** All chart stories render correctly in both light and dark mode

### Phase 4 — Data ingestion backend

1. Implement `models/` — all Rust domain structs with serde derives
2. Implement `ingestion/session_store.rs` — age encryption for Rivian tokens
3. Implement `ingestion/parser.rs` — Rivian GraphQL response deserialization
   - Write proptest fuzz tests immediately
4. Implement `ingestion/ws_client.rs` — WebSocket connection manager with reconnect
5. Implement `ingestion/poller.rs` — adaptive polling state machine
6. Implement `ingestion/trip_detector.rs` — powerState boundary detection
   - Write state machine tests for all transition sequences
7. Write integration test: simulate WebSocket messages → verify rows written to DB
8. **Gate:** All ingestion tests pass; proptest runs 10,000 cases without panic

### Phase 5 — API routes

Build routes in this order, with integration tests for each:

1. `routes/auth.rs` — register, login, JWT issuance
2. `middleware/auth.rs` — JWT validation; add to all subsequent routes
3. `routes/vehicles.rs` — add vehicle (triggers Rivian auth), list vehicles
4. `routes/battery.rs` — all battery endpoints; test resolution selection
5. `routes/trips.rs` — trip list + detail endpoints; test pagination
6. `routes/charging.rs` — session list + detail + charge curve
7. `routes/efficiency.rs` — all efficiency endpoints
8. **Gate:** All route integration tests pass; no endpoints return data from wrong user

### Phase 6 — Frontend web app

1. Initialize Vite + React app at `apps/web/`
2. Install and configure TanStack Router with file-based routes
3. Set up React Query client with default config
4. Implement `PageLayout`, `StatCardGrid`, `ChartSection` layout components
5. Implement `packages/hooks/` — all data hooks wiring React Query to API types
6. Build pages in order: Home → Battery → Trips → Charging → Efficiency → Settings
7. Wire live WebSocket status to Zustand store and StatusBar
8. **Gate:** Playwright E2E tests pass; all pages load without console errors

### Phase 7 — Polish & production readiness

1. Implement `DataTable` with TanStack Table for trips and charging (sort, filter, pagination)
2. Implement `DateRangePicker` and wire to all chart pages
3. Add Framer Motion page transitions and chart entry animations
4. Implement dark mode toggle with persistence
5. Implement settings page (electricity rate, home location, unit preferences)
6. Add Grafana-compatible endpoints with API key auth
7. Add data export (CSV download for trips, GPX for trip tracks)
8. Write remaining Playwright E2E tests
9. Security audit: verify no cross-user data leakage, test rate limiting
10. **Gate:** Full CI passes; Storybook builds; E2E suite passes

---

## Reference Links

- **Rivian unofficial API docs:** https://rivian-api.kaedenb.org/
- **Rivian WebSocket subscription endpoint:** `wss://api.rivian.com/gql-consumer-subscriptions/graphql`
- **Rivian GraphQL POST endpoint:** `https://rivian.com/api/gql/gateway/graphql`
- **HASS Rivian integration (reference implementation):** https://github.com/bretterer/home-assistant-rivian
- **rivian-python-client (reference for auth flow):** https://github.com/bretterer/rivian-python-client
- **TeslaMATE (metric & dashboard inspiration):** https://github.com/adriankumpf/teslamate
- **TimescaleDB continuous aggregates docs:** https://docs.timescale.com/use-timescale/latest/continuous-aggregates/
- **Axum docs:** https://docs.rs/axum/latest/axum/
- **TanStack Table:** https://tanstack.com/table/latest
- **Recharts:** https://recharts.org/en-US/api
- **Maplibre GL JS:** https://maplibre.org/maplibre-gl-js/docs/

---

*Document version: 1.0 — Generated for initial agent build session*
*Last updated: 2026-04-26*

---

## 17. Complete Cargo.toml

> **For the agent:** Use exactly these dependency versions. Do not upgrade without explicit instruction — version mismatches between Axum, Tower, and Tokio are the primary source of compilation failures.

```toml
# apps/api/Cargo.toml
[package]
name    = "rivianmate-api"
version = "0.1.0"
edition = "2021"
rust-version = "1.78"

[[bin]]
name = "rivianmate-api"
path = "src/main.rs"

[dependencies]
# Web framework
axum            = { version = "0.7", features = ["macros", "ws"] }
axum-extra      = { version = "0.9", features = ["typed-header"] }
tower           = { version = "0.4", features = ["full"] }
tower-http      = { version = "0.5", features = ["cors", "compression-gzip", "request-id", "trace", "limit"] }
tower-governor  = "0.4"

# Async runtime
tokio           = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.23", features = ["native-tls"] }

# Database
sqlx            = { version = "0.7", features = ["postgres", "runtime-tokio-native-tls", "uuid", "chrono", "json", "migrate"] }

# HTTP client (for Rivian API polling)
reqwest         = { version = "0.12", features = ["json", "native-tls"] }

# Serialization
serde           = { version = "1", features = ["derive"] }
serde_json      = "1"

# Auth
jsonwebtoken    = "9"
argon2          = "0.5"

# Encryption (Rivian credential storage)
age             = { version = "0.10", features = ["async"] }

# Types
uuid            = { version = "1", features = ["v4", "serde"] }
chrono          = { version = "0.4", features = ["serde"] }

# Config
envy            = "0.4"

# Error handling
thiserror       = "1"
anyhow          = "1"

# Observability
tracing                   = "0.1"
tracing-subscriber        = { version = "0.3", features = ["env-filter", "json"] }
tracing-opentelemetry     = "0.24"

# Utilities
once_cell       = "1"
futures         = "0.3"
async-trait     = "0.1"
base64          = "0.22"
hex             = "0.4"
rand            = "0.8"

[dev-dependencies]
testcontainers          = "0.18"
testcontainers-modules  = { version = "0.4", features = ["postgres"] }
proptest                = "1"
tokio                   = { version = "1", features = ["full", "test-util"] }
axum-test               = "0.3"

[profile.release]
opt-level     = 3
lto           = true
codegen-units = 1
strip         = true
```

---

## 18. Complete Rust Source Files

### src/main.rs

```rust
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod db;
mod errors;
mod ingestion;
mod middleware;
mod models;
mod routes;

use config::Config;
use db::pool::create_pool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Structured logging
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "rivianmate_api=debug,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let config = Config::from_env()?;
    let pool   = create_pool(&config.database_url).await?;

    // Run migrations on startup
    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("Migrations applied");

    // Build the application router
    let app = routes::build_router(pool.clone(), config.clone());

    // Start ingestion workers (one per enrolled vehicle)
    ingestion::start_workers(pool.clone(), config.clone()).await?;

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;
    tracing::info!("Listening on {}", addr);

    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

### src/config.rs

```rust
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url:     String,
    pub redis_url:        String,
    pub jwt_secret:       String,     // RS256 private key PEM
    pub jwt_public_key:   String,     // RS256 public key PEM
    pub age_key:          String,     // age X25519 identity for token encryption
    pub port:             u16,
    pub allowed_origins:  Vec<String>,
    pub minio_endpoint:   String,
    pub minio_access_key: String,
    pub minio_secret_key: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        envy::from_env::<Config>().map_err(|e| anyhow::anyhow!("Config error: {}", e))
    }
}
```

### src/models/telemetry.rs

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Raw telemetry event as received from the Rivian WebSocket.
/// All fields are Option because Rivian sends partial updates —
/// not every field is present in every message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub vehicle_id:   Uuid,
    pub ts:           DateTime<Utc>,

    // Location
    pub latitude:     Option<f64>,
    pub longitude:    Option<f64>,
    pub altitude_m:   Option<f64>,
    pub speed_mph:    Option<f64>,

    // Battery
    pub battery_level:       Option<f64>,  // SOC 0–100
    pub battery_capacity_wh: Option<f64>,
    pub distance_to_empty_mi:Option<f64>,
    pub battery_limit:       Option<f64>,

    // State
    pub power_state:                Option<PowerState>,
    pub charger_state:              Option<ChargerState>,
    pub charger_status:             Option<String>,
    pub time_to_end_of_charge_min:  Option<i32>,
    pub drive_mode:                 Option<DriveMode>,
    pub gear_status:                Option<String>,

    // Climate
    pub cabin_temp_c:   Option<f64>,
    pub driver_temp_c:  Option<f64>,

    // Vehicle
    pub odometer_miles:     Option<f64>,
    pub hv_thermal_event:   Option<String>,
    pub twelve_volt_health: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "lowercase")]
pub enum PowerState {
    Sleep,
    Ready,
    Go,
    Drive,
    Charging,
    Unknown,
}

impl std::str::FromStr for PowerState {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "sleep"    => PowerState::Sleep,
            "ready"    => PowerState::Ready,
            "go"       => PowerState::Go,
            "drive"    => PowerState::Drive,
            "charging" => PowerState::Charging,
            _          => PowerState::Unknown,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "lowercase")]
pub enum ChargerState {
    Disconnected,
    Connected,
    Charging,
    Done,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "snake_case")]
pub enum DriveMode {
    Sport,
    AllPurpose,
    Conserve,
    OffRoad,
    Unknown,
}
```

### src/models/trip.rs

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Trip {
    pub id:              Uuid,
    pub vehicle_id:      Uuid,
    pub started_at:      DateTime<Utc>,
    pub ended_at:        DateTime<Utc>,
    pub start_lat:       Option<f64>,
    pub start_lng:       Option<f64>,
    pub end_lat:         Option<f64>,
    pub end_lng:         Option<f64>,
    pub distance_miles:  Option<f64>,
    pub duration_seconds:Option<i64>,
    pub soc_start:       Option<f64>,
    pub soc_end:         Option<f64>,
    pub efficiency_wh_per_mile: Option<f64>,
    pub max_speed_mph:   Option<f64>,
    pub drive_mode:      Option<String>,
    pub outside_temp_c:  Option<f64>,
}

/// API response shape — what the client receives
#[derive(Debug, Serialize)]
pub struct TripResponse {
    pub id:               Uuid,
    pub started_at:       DateTime<Utc>,
    pub ended_at:         DateTime<Utc>,
    pub duration_seconds: i64,
    pub distance_miles:   f64,
    pub efficiency_wh_per_mile: Option<f64>,
    pub max_speed_mph:    Option<f64>,
    pub drive_mode:       Option<String>,
    pub soc_start:        Option<f64>,
    pub soc_end:          Option<f64>,
    pub start_location:   Option<LatLng>,
    pub end_location:     Option<LatLng>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatLng {
    pub lat: f64,
    pub lng: f64,
}

/// GPS track point for map rendering
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TrackPoint {
    pub ts:        DateTime<Utc>,
    pub lat:       f64,
    pub lng:       f64,
    pub speed_mph: Option<f64>,
    pub altitude_m:Option<f64>,
}

/// List query parameters
#[derive(Debug, Deserialize)]
pub struct TripListParams {
    pub from:   Option<DateTime<Utc>>,
    pub to:     Option<DateTime<Utc>>,
    pub limit:  Option<i64>,    // default 50, max 200
    pub offset: Option<i64>,
}
```

### src/models/charge_session.rs

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ChargeSession {
    pub id:              Uuid,
    pub vehicle_id:      Uuid,
    pub started_at:      DateTime<Utc>,
    pub ended_at:        Option<DateTime<Utc>>,
    pub location_lat:    Option<f64>,
    pub location_lng:    Option<f64>,
    pub is_home:         Option<bool>,
    pub charger_type:    Option<String>,
    pub kwh_added:       Option<f64>,
    pub soc_start:       Option<f64>,
    pub soc_end:         Option<f64>,
    pub charge_limit:    Option<f64>,
    pub max_charge_rate_kw: Option<f64>,
    pub duration_minutes:Option<i32>,
    pub cost_usd:        Option<f64>,
}

/// A single point on the charge curve (kW + SOC over time)
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChargeCurvePoint {
    pub minutes_elapsed: f64,
    pub charge_rate_kw:  f64,
    pub soc:             f64,
}

#[derive(Debug, Deserialize)]
pub struct SessionListParams {
    pub from:            Option<DateTime<Utc>>,
    pub to:              Option<DateTime<Utc>>,
    pub limit:           Option<i64>,
    pub offset:          Option<i64>,
    pub rate_per_kwh:    Option<f64>,   // override user preference for cost calc
}
```

### src/ingestion/parser.rs

```rust
//! Parses Rivian GraphQL WebSocket subscription messages into TelemetryEvent.
//!
//! The Rivian WebSocket sends partial updates — only changed fields are present.
//! Every field is therefore optional in the raw message and we must handle
//! missing fields gracefully without panic.

use crate::models::telemetry::{ChargerState, DriveMode, PowerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Missing vehicleState in payload")]
    MissingVehicleState,
    #[error("Invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("Invalid timestamp: {0}")]
    InvalidTimestamp(String),
}

/// Parse a raw WebSocket message JSON string into a TelemetryEvent.
/// Returns None for non-data messages (connection_ack, ping, etc).
/// Never panics — all field parsing is defensive.
pub fn parse_ws_message(
    raw:        &str,
    vehicle_id: Uuid,
) -> Result<Option<TelemetryEvent>, ParseError> {
    let msg: Value = serde_json::from_str(raw)?;

    // Only process "next" type messages (subscription data)
    match msg.get("type").and_then(Value::as_str) {
        Some("next") => {},
        _            => return Ok(None),
    }

    let state = msg
        .pointer("/payload/data/vehicleState")
        .ok_or(ParseError::MissingVehicleState)?;

    // Use the most recent timestamp across all fields as the event timestamp.
    // Fall back to now() if no timestamps are present.
    let ts = extract_latest_timestamp(state).unwrap_or_else(Utc::now);

    Ok(Some(TelemetryEvent {
        vehicle_id,
        ts,

        latitude:    extract_f64(state, "/gnssLocation/latitude"),
        longitude:   extract_f64(state, "/gnssLocation/longitude"),
        altitude_m:  extract_f64(state, "/gnssAltitude/value"),
        speed_mph:   extract_f64(state, "/gnssSpeed/value").map(ms_to_mph),

        battery_level:        extract_f64(state, "/batteryLevel/value"),
        battery_capacity_wh:  extract_f64(state, "/batteryCapacity/value"),
        distance_to_empty_mi: extract_f64(state, "/distanceToEmpty/value"),
        battery_limit:        extract_f64(state, "/batteryLimit/value"),

        power_state:   extract_str(state, "/powerState/value")
                          .and_then(|s| s.parse().ok()),
        charger_state: extract_str(state, "/chargerState/value")
                          .and_then(|s| parse_charger_state(s)),
        charger_status: extract_str(state, "/chargerStatus/value").map(String::from),
        time_to_end_of_charge_min: extract_i32(state, "/timeToEndOfCharge/value"),
        drive_mode:    extract_str(state, "/driveMode/value")
                          .and_then(|s| parse_drive_mode(s)),
        gear_status:   extract_str(state, "/gearStatus/value").map(String::from),

        cabin_temp_c:  extract_f64(state, "/cabinClimateInteriorTemperature/value"),
        driver_temp_c: extract_f64(state, "/cabinClimateDriverTemperature/value"),

        odometer_miles:     extract_f64(state, "/vehicleMileage/value"),
        hv_thermal_event:   extract_str(state, "/batteryHvThermalEvent/value").map(String::from),
        twelve_volt_health: extract_str(state, "/twelveVoltBatteryHealth/value").map(String::from),
    }))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn extract_f64(v: &Value, ptr: &str) -> Option<f64> {
    v.pointer(ptr)?.as_f64()
}

fn extract_i32(v: &Value, ptr: &str) -> Option<i32> {
    v.pointer(ptr)?.as_i64().and_then(|n| i32::try_from(n).ok())
}

fn extract_str<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr)?.as_str()
}

fn extract_latest_timestamp(state: &Value) -> Option<DateTime<Utc>> {
    // Collect all timeStamp strings from the state object
    let mut latest: Option<DateTime<Utc>> = None;
    collect_timestamps(state, &mut latest);
    latest
}

fn collect_timestamps(v: &Value, latest: &mut Option<DateTime<Utc>>) {
    match v {
        Value::Object(map) => {
            if let Some(Value::String(ts)) = map.get("timeStamp") {
                if let Ok(dt) = ts.parse::<DateTime<Utc>>() {
                    if latest.map_or(true, |l| dt > l) {
                        *latest = Some(dt);
                    }
                }
            }
            for val in map.values() {
                collect_timestamps(val, latest);
            }
        }
        Value::Array(arr) => {
            for val in arr {
                collect_timestamps(val, latest);
            }
        }
        _ => {}
    }
}

fn ms_to_mph(ms: f64) -> f64 {
    ms * 2.236_94
}

fn parse_charger_state(s: &str) -> Option<ChargerState> {
    Some(match s.to_lowercase().as_str() {
        "disconnected"         => ChargerState::Disconnected,
        "connected"            => ChargerState::Connected,
        "charging_active"
        | "charging"           => ChargerState::Charging,
        "charging_done" | "done" => ChargerState::Done,
        _                      => ChargerState::Unknown,
    })
}

fn parse_drive_mode(s: &str) -> Option<DriveMode> {
    Some(match s.to_lowercase().as_str() {
        "sport"                  => DriveMode::Sport,
        "all_purpose" | "normal" => DriveMode::AllPurpose,
        "conserve"               => DriveMode::Conserve,
        "off_road"               => DriveMode::OffRoad,
        _                        => DriveMode::Unknown,
    })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn vehicle_id() -> Uuid { Uuid::new_v4() }

    #[test]
    fn parse_connection_ack_returns_none() {
        let msg = r#"{"type":"connection_ack"}"#;
        let result = parse_ws_message(msg, vehicle_id()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn parse_next_with_battery_level() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": {
                "data": {
                    "vehicleState": {
                        "batteryLevel": {
                            "timeStamp": "2024-01-15T10:30:00.000Z",
                            "value": 82.5
                        },
                        "powerState": {
                            "timeStamp": "2024-01-15T10:30:00.000Z",
                            "value": "ready"
                        }
                    }
                }
            }
        }).to_string();

        let event = parse_ws_message(&msg, vehicle_id()).unwrap().unwrap();
        assert_eq!(event.battery_level, Some(82.5));
        assert_eq!(event.power_state, Some(PowerState::Ready));
    }

    #[test]
    fn parse_missing_vehicle_state_returns_error() {
        let msg = serde_json::json!({
            "type": "next",
            "payload": { "data": {} }
        }).to_string();

        assert!(matches!(
            parse_ws_message(&msg, vehicle_id()),
            Err(ParseError::MissingVehicleState)
        ));
    }

    #[test]
    fn parse_partial_update_leaves_missing_fields_none() {
        // Rivian sends partial updates — only changed fields present
        let msg = serde_json::json!({
            "type": "next",
            "payload": {
                "data": {
                    "vehicleState": {
                        "batteryLevel": { "timeStamp": "2024-01-15T10:30:00Z", "value": 75.0 }
                    }
                }
            }
        }).to_string();

        let event = parse_ws_message(&msg, vehicle_id()).unwrap().unwrap();
        assert_eq!(event.battery_level, Some(75.0));
        assert!(event.latitude.is_none());
        assert!(event.speed_mph.is_none());
        assert!(event.power_state.is_none());
    }
}
```

### src/ingestion/trip_detector.rs

```rust
//! Detects trip boundaries from a stream of powerState + speed observations.

use crate::models::{
    telemetry::{PowerState, TelemetryEvent},
    trip::{LatLng, Trip},
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

const STOPPED_SPEED_MPH:        f64 = 2.0;   // below this = not moving
const STOPPED_DURATION_SECS:    i64 = 300;    // 5 min stationary = trip end
const MIN_TRIP_DISTANCE_MILES:  f64 = 0.1;    // ignore micro-trips

#[derive(Debug, Clone, PartialEq)]
pub enum TripEvent {
    TripStarted { trip_id: Uuid, started_at: DateTime<Utc> },
    TripEnded   { trip: CompletedTripData },
    NoChange,
}

#[derive(Debug, Clone)]
pub struct CompletedTripData {
    pub vehicle_id:      Uuid,
    pub started_at:      DateTime<Utc>,
    pub ended_at:        DateTime<Utc>,
    pub points:          Vec<TrackPoint>,
    pub soc_start:       Option<f64>,
    pub soc_end:         Option<f64>,
    pub battery_capacity_wh: Option<f64>,
    pub dominant_drive_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TrackPoint {
    pub ts:        DateTime<Utc>,
    pub lat:       f64,
    pub lng:       f64,
    pub speed_mph: f64,
    pub altitude_m:Option<f64>,
}

/// Mutable state held per vehicle in the ingestion worker
#[derive(Debug, Default)]
pub struct TripDetectorState {
    active_trip_id:   Option<Uuid>,
    trip_started_at:  Option<DateTime<Utc>>,
    track_points:     Vec<TrackPoint>,
    soc_at_start:     Option<f64>,
    drive_modes:      Vec<String>,
    last_moving_at:   Option<DateTime<Utc>>,
    battery_capacity: Option<f64>,
}

impl TripDetectorState {
    pub fn new() -> Self { Self::default() }

    /// Feed one telemetry event; returns what happened (if anything)
    pub fn process(&mut self, event: &TelemetryEvent) -> TripEvent {
        let power  = event.power_state.as_ref();
        let speed  = event.speed_mph.unwrap_or(0.0);
        let ts     = event.ts;

        // Collect battery capacity for efficiency calculation
        if let Some(cap) = event.battery_capacity_wh {
            self.battery_capacity = Some(cap);
        }

        let is_moving = speed > STOPPED_SPEED_MPH;
        let is_awake  = matches!(power, Some(PowerState::Drive | PowerState::Go | PowerState::Ready));
        let is_asleep = matches!(power, Some(PowerState::Sleep));

        // Accumulate track points while trip is active
        if self.active_trip_id.is_some() {
            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
                self.track_points.push(TrackPoint {
                    ts,
                    lat,
                    lng,
                    speed_mph: speed,
                    altitude_m: event.altitude_m,
                });
            }
            if let Some(dm) = &event.drive_mode {
                self.drive_modes.push(format!("{:?}", dm));
            }
        }

        // ── Trip start detection ──────────────────────────────────────────
        if self.active_trip_id.is_none() && is_moving && is_awake {
            let trip_id = Uuid::new_v4();
            self.active_trip_id  = Some(trip_id);
            self.trip_started_at = Some(ts);
            self.soc_at_start    = event.battery_level;
            self.last_moving_at  = Some(ts);

            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
                self.track_points.push(TrackPoint { ts, lat, lng, speed_mph: speed, altitude_m: event.altitude_m });
            }

            return TripEvent::TripStarted { trip_id, started_at: ts };
        }

        // ── Trip end detection ────────────────────────────────────────────
        if self.active_trip_id.is_some() {
            if is_moving {
                self.last_moving_at = Some(ts);
            }

            let stopped_long_enough = self.last_moving_at.map_or(false, |last| {
                (ts - last).num_seconds() > STOPPED_DURATION_SECS
            });

            if is_asleep || stopped_long_enough {
                return self.close_trip(ts);
            }
        }

        TripEvent::NoChange
    }

    fn close_trip(&mut self, ended_at: DateTime<Utc>) -> TripEvent {
        let data = CompletedTripData {
            vehicle_id:      Uuid::nil(), // caller fills in from context
            started_at:      self.trip_started_at.unwrap_or(ended_at),
            ended_at,
            points:          std::mem::take(&mut self.track_points),
            soc_start:       self.soc_at_start,
            soc_end:         None,        // caller fills from last telemetry
            battery_capacity_wh: self.battery_capacity,
            dominant_drive_mode: mode_of(&self.drive_modes),
        };

        self.active_trip_id  = None;
        self.trip_started_at = None;
        self.soc_at_start    = None;
        self.last_moving_at  = None;
        self.drive_modes.clear();

        TripEvent::TripEnded { trip: data }
    }
}

/// Returns the most frequent element in a vec of strings
fn mode_of(v: &[String]) -> Option<String> {
    if v.is_empty() { return None; }
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for s in v { *counts.entry(s.as_str()).or_insert(0) += 1; }
    counts.into_iter().max_by_key(|&(_, c)| c).map(|(s, _)| s.to_string())
}

/// Compute total distance from a series of GPS track points (haversine sum)
pub fn compute_distance_miles(points: &[TrackPoint]) -> f64 {
    points.windows(2).map(|w| haversine_miles(w[0].lat, w[0].lng, w[1].lat, w[1].lng)).sum()
}

fn haversine_miles(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 3_958.8; // Earth radius in miles
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::telemetry::PowerState;

    fn event(power: PowerState, speed: f64, ts_offset_secs: i64) -> TelemetryEvent {
        let base = chrono::DateTime::parse_from_rfc3339("2024-01-15T08:00:00Z")
            .unwrap().with_timezone(&Utc);
        let ts = base + chrono::Duration::seconds(ts_offset_secs);
        TelemetryEvent {
            vehicle_id: Uuid::nil(),
            ts,
            latitude: Some(30.267_153),
            longitude: Some(-97.743_061),
            altitude_m: None,
            speed_mph: Some(speed),
            battery_level: Some(80.0),
            battery_capacity_wh: Some(135_000.0),
            distance_to_empty_mi: None,
            battery_limit: None,
            power_state: Some(power),
            charger_state: None,
            charger_status: None,
            time_to_end_of_charge_min: None,
            drive_mode: None,
            gear_status: None,
            cabin_temp_c: None,
            driver_temp_c: None,
            odometer_miles: None,
            hv_thermal_event: None,
            twelve_volt_health: None,
        }
    }

    #[test]
    fn trip_starts_when_moving_and_awake() {
        let mut detector = TripDetectorState::new();
        let result = detector.process(&event(PowerState::Drive, 35.0, 0));
        assert!(matches!(result, TripEvent::TripStarted { .. }));
    }

    #[test]
    fn no_trip_when_stationary_and_ready() {
        let mut detector = TripDetectorState::new();
        let result = detector.process(&event(PowerState::Ready, 0.0, 0));
        assert_eq!(result, TripEvent::NoChange);
    }

    #[test]
    fn trip_ends_on_sleep() {
        let mut detector = TripDetectorState::new();
        detector.process(&event(PowerState::Drive, 35.0, 0));
        let result = detector.process(&event(PowerState::Sleep, 0.0, 10));
        assert!(matches!(result, TripEvent::TripEnded { .. }));
    }

    #[test]
    fn trip_ends_after_5min_stopped() {
        let mut detector = TripDetectorState::new();
        detector.process(&event(PowerState::Drive, 35.0, 0));
        detector.process(&event(PowerState::Ready, 1.0, 60));  // still moving
        let result = detector.process(&event(PowerState::Ready, 0.0, 400)); // stopped > 5 min
        assert!(matches!(result, TripEvent::TripEnded { .. }));
    }

    #[test]
    fn haversine_austin_to_san_antonio() {
        // Austin TX to San Antonio TX ≈ 80 miles
        let d = haversine_miles(30.267_153, -97.743_061, 29.424_122, -98.493_629);
        assert!((d - 79.0).abs() < 3.0, "Expected ~79 miles, got {}", d);
    }
}
```

### src/routes/mod.rs

```rust
use axum::{middleware, Router};
use sqlx::PgPool;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    request_id::{MakeRequestUuid, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::config::Config;
use crate::middleware::auth::auth_middleware;

mod auth;
mod battery;
mod charging;
mod efficiency;
mod trips;
mod vehicles;

pub fn build_router(pool: PgPool, config: Config) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)  // Restrict in production via config
        .allow_methods(Any)
        .allow_headers(Any);

    // Public routes (no auth required)
    let public = Router::new()
        .merge(auth::router())
        .route("/health", axum::routing::get(health));

    // Protected routes (JWT required)
    let protected = Router::new()
        .merge(vehicles::router())
        .merge(battery::router())
        .merge(trips::router())
        .merge(charging::router())
        .merge(efficiency::router())
        .layer(middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ));

    Router::new()
        .merge(public)
        .nest("/v1", protected)
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .with_state(pool)
}

async fn health() -> &'static str { "ok" }
```

### src/routes/battery.rs

```rust
use axum::{extract::{Query, State}, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{errors::AppError, middleware::auth::AuthUser};

pub fn router() -> Router<PgPool> {
    Router::new()
        .route("/battery/soc",          get(get_soc))
        .route("/battery/range",        get(get_range))
        .route("/battery/capacity",     get(get_capacity))
        .route("/battery/phantom-drain",get(get_phantom_drain))
}

#[derive(Debug, Deserialize)]
pub struct TimeRangeParams {
    pub from:       Option<DateTime<Utc>>,
    pub to:         Option<DateTime<Utc>>,
    pub vehicle_id: Option<String>,
}

/// A single time-series data point returned to the client
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TimeSeriesPoint {
    pub ts:    DateTime<Utc>,
    pub value: f64,
}

/// Select the appropriate pre-aggregated table based on date range span.
/// Returns (table_name, time_bucket_interval, value_column)
fn select_resolution(from: DateTime<Utc>, to: DateTime<Utc>) -> (&'static str, &'static str) {
    let span = (to - from).num_hours();
    match span {
        0..=48   => ("timeseries.telemetry_1min", "bucket"),
        49..=2160 => ("timeseries.telemetry_1hr",  "bucket"),
        _         => ("timeseries.telemetry_1day", "bucket"),
    }
}

async fn get_soc(
    State(pool): State<PgPool>,
    auth: AuthUser,
    Query(params): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(7));
    let to   = params.to.unwrap_or_else(Utc::now);

    let (table, bucket_col) = select_resolution(from, to);

    // sqlx doesn't support dynamic table names — use match to select typed query
    let points = match table {
        "timeseries.telemetry_1min" => {
            sqlx::query_as!(
                TimeSeriesPoint,
                r#"SELECT bucket AS ts, avg_soc AS value
                   FROM timeseries.telemetry_1min
                   WHERE vehicle_id = $1
                     AND bucket >= $2 AND bucket <= $3
                   ORDER BY bucket ASC"#,
                auth.vehicle_id,
                from,
                to,
            )
            .fetch_all(&pool)
            .await?
        }
        "timeseries.telemetry_1hr" => {
            sqlx::query_as!(
                TimeSeriesPoint,
                r#"SELECT bucket AS ts, avg_soc AS value
                   FROM timeseries.telemetry_1hr
                   WHERE vehicle_id = $1
                     AND bucket >= $2 AND bucket <= $3
                   ORDER BY bucket ASC"#,
                auth.vehicle_id, from, to,
            )
            .fetch_all(&pool)
            .await?
        }
        _ => {
            sqlx::query_as!(
                TimeSeriesPoint,
                r#"SELECT bucket AS ts, avg_soc AS value
                   FROM timeseries.telemetry_1day
                   WHERE vehicle_id = $1
                     AND bucket >= $2 AND bucket <= $3
                   ORDER BY bucket ASC"#,
                auth.vehicle_id, from, to,
            )
            .fetch_all(&pool)
            .await?
        }
    };

    Ok(Json(points))
}

async fn get_range(
    State(pool): State<PgPool>,
    auth: AuthUser,
    Query(params): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to   = params.to.unwrap_or_else(Utc::now);

    let points = sqlx::query_as!(
        TimeSeriesPoint,
        r#"SELECT bucket AS ts, avg_range_mi AS value
           FROM timeseries.telemetry_1hr
           WHERE vehicle_id = $1
             AND bucket >= $2 AND bucket <= $3
             AND avg_range_mi IS NOT NULL
           ORDER BY bucket ASC"#,
        auth.vehicle_id, from, to,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(points))
}

async fn get_capacity(
    State(pool): State<PgPool>,
    auth: AuthUser,
    Query(params): Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to   = params.to.unwrap_or_else(Utc::now);

    // Battery capacity trend: daily max (shows degradation over time)
    let points = sqlx::query_as!(
        TimeSeriesPoint,
        r#"SELECT bucket AS ts, battery_capacity_wh AS value
           FROM timeseries.telemetry_1day
           WHERE vehicle_id = $1
             AND bucket >= $2 AND bucket <= $3
             AND battery_capacity_wh IS NOT NULL
           ORDER BY bucket ASC"#,
        auth.vehicle_id, from, to,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(points))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PhantomDrainPoint {
    pub day:              DateTime<Utc>,
    pub total_soc_lost:   f64,
    pub avg_drain_rate:   f64,
    pub hours_parked:     f64,
}

async fn get_phantom_drain(
    State(pool): State<PgPool>,
    auth: AuthUser,
    Query(params): Query<TimeRangeParams>,
) -> Result<Json<Vec<PhantomDrainPoint>>, AppError> {
    let from = params.from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to   = params.to.unwrap_or_else(Utc::now);

    let points = sqlx::query_as!(
        PhantomDrainPoint,
        r#"SELECT
             day,
             total_soc_lost,
             avg_drain_rate,
             total_hours_parked AS hours_parked
           FROM timeseries.phantom_drain_daily
           WHERE vehicle_id = $1
             AND day >= $2 AND day <= $3
           ORDER BY day ASC"#,
        auth.vehicle_id, from, to,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(points))
}
```

---

## 19. Complete Frontend Bootstrap Files

### apps/web/package.json

```json
{
  "name": "@rivianmate/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":       "vite",
    "build":     "tsc -b && vite build",
    "preview":   "vite preview",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --max-warnings 0",
    "test":      "vitest run",
    "test:watch":"vitest",
    "test:e2e":  "playwright test",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "dependencies": {
    "@rivianmate/hooks":  "workspace:*",
    "@rivianmate/types":  "workspace:*",
    "@rivianmate/ui":     "workspace:*",
    "@tanstack/react-query": "^5.40.0",
    "@tanstack/react-router": "^1.40.0",
    "@tanstack/react-table":  "^8.17.0",
    "framer-motion":      "^11.2.0",
    "lucide-react":       "^0.390.0",
    "maplibre-gl":        "^4.4.0",
    "react":              "^18.3.1",
    "react-dom":          "^18.3.1",
    "recharts":           "^2.12.0",
    "zustand":            "^4.5.0",
    "zod":                "^3.23.0",
    "react-hook-form":    "^7.52.0",
    "@hookform/resolvers": "^3.6.0",
    "date-fns":           "^3.6.0"
  },
  "devDependencies": {
    "@rivianmate/config":              "workspace:*",
    "@playwright/test":                "^1.45.0",
    "@storybook/react-vite":           "^8.1.0",
    "@storybook/testing-library":      "^0.2.0",
    "@testing-library/react":          "^16.0.0",
    "@testing-library/user-event":     "^14.5.0",
    "@types/react":                    "^18.3.3",
    "@types/react-dom":                "^18.3.0",
    "@vitejs/plugin-react":            "^4.3.0",
    "autoprefixer":                    "^10.4.19",
    "postcss":                         "^8.4.38",
    "tailwindcss":                     "^3.4.4",
    "typescript":                      "^5.4.5",
    "vite":                            "^5.3.1",
    "vitest":                          "^1.6.0",
    "@vitest/ui":                      "^1.6.0",
    "jsdom":                           "^24.1.0"
  }
}
```

### apps/web/vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/v1':     'http://localhost:3001',
      '/auth':   'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  test: {
    globals:     true,
    environment: 'jsdom',
    setupFiles:  ['./src/test/setup.ts'],
    css:         true,
  },
});
```

### apps/web/tailwind.config.ts

```typescript
import type { Config } from 'tailwindcss';
import { tailwindBase } from '@rivianmate/config/tailwind/base';

export default {
  ...tailwindBase,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
```

### apps/web/src/main.tsx

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { ChartProvider } from '@rivianmate/ui/charts';
import { routeTree } from './routeTree.gen';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           60_000,
      gcTime:              300_000,
      retry:               2,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChartProvider>
        <RouterProvider router={router} />
      </ChartProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

### apps/web/src/routes/__root.tsx

```tsx
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatusBar } from '@/components/layout/StatusBar';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen bg-surface-page text-text-primary overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <StatusBar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

### apps/web/src/routes/index.tsx (Home dashboard)

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useVehicleStatus } from '@rivianmate/hooks';
import { StatCard, StatCardGrid, GaugeChart, PageLayout } from '@rivianmate/ui';
import { useSummaryStats } from '@/lib/hooks/useSummaryStats';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const status = useVehicleStatus();
  const stats  = useSummaryStats();

  return (
    <PageLayout title="Overview" subtitle="Your Rivian at a glance">
      {/* Live status row */}
      <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1 flex items-center justify-center">
          <GaugeChart
            value={status.batteryLevel ?? 0}
            label="State of charge"
            unit="%"
            size="lg"
            loading={!status.isOnline}
          />
        </div>
        <StatCard
          label="Estimated range"
          value={Math.round(status.distanceToEmpty ?? 0)}
          unit="mi"
          loading={!status.isOnline}
          color={status.distanceToEmpty && status.distanceToEmpty < 50 ? 'red' : 'default'}
        />
        <StatCard
          label="Power state"
          value={status.powerState ?? '—'}
          loading={!status.isOnline}
        />
        <StatCard
          label="Charger"
          value={status.chargerState ?? 'disconnected'}
          color={status.chargerState === 'charging' ? 'amber' : 'default'}
          loading={!status.isOnline}
        />
      </div>

      {/* Lifetime summary stats */}
      <StatCardGrid>
        <StatCard label="Total miles" value={stats.data?.total_miles_formatted ?? '—'} loading={stats.isLoading} />
        <StatCard label="Total trips"   value={stats.data?.total_trips ?? '—'}           loading={stats.isLoading} />
        <StatCard label="Total kWh"     value={stats.data?.total_kwh_formatted ?? '—'}   loading={stats.isLoading} />
        <StatCard label="Lifetime efficiency" value={stats.data?.lifetime_efficiency_formatted ?? '—'} unit="Wh/mi" loading={stats.isLoading} />
      </StatCardGrid>
    </PageLayout>
  );
}
```

### apps/web/src/routes/battery/index.tsx

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useBattery } from '@rivianmate/hooks';
import {
  AreaChart,
  BarChart,
  GaugeChart,
  StatCard,
  StatCardGrid,
  DateRangePicker,
  ChartSection,
  PageLayout,
} from '@rivianmate/ui';
import { defaultDateRange } from '@/lib/dates';
import type { DateRange } from '@rivianmate/types';

export const Route = createFileRoute('/battery/')({
  component: BatteryPage,
});

function BatteryPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange(30));
  const { soc, range: rangeEstimate, phantomDrain, capacityHealth } = useBattery(range);

  return (
    <PageLayout
      title="Battery"
      subtitle="State of charge, range, and health"
      headerRight={<DateRangePicker value={range} onChange={setRange} />}
    >
      <StatCardGrid>
        <StatCard label="Current SOC"    value={soc.data?.at(-1)?.value ?? 0} unit="%" />
        <StatCard label="Est. range"     value={rangeEstimate.data?.at(-1)?.value ?? 0} unit="mi" />
        <StatCard label="Battery health" value={capacityHealth.data?.at(-1)?.value ?? 0} unit="Wh" />
      </StatCardGrid>

      <ChartSection title="State of charge" description="Battery percentage over time">
        <AreaChart
          data={soc.data ?? []}
          dataKey="value"
          label="SOC (%)"
          unit="%"
          domain={[0, 100]}
          loading={soc.isLoading}
          error={soc.error?.message}
          threshold={{ value: 20, color: '#EF4444', label: 'Low SOC' }}
        />
      </ChartSection>

      <ChartSection title="Estimated range" description="Distance to empty over time">
        <AreaChart
          data={rangeEstimate.data ?? []}
          dataKey="value"
          label="Range (mi)"
          unit=" mi"
          loading={rangeEstimate.isLoading}
        />
      </ChartSection>

      <ChartSection
        title="Battery capacity health"
        description="Nominal capacity in Wh — decline indicates battery degradation"
      >
        <AreaChart
          data={capacityHealth.data ?? []}
          dataKey="value"
          label="Capacity (Wh)"
          unit=" Wh"
          loading={capacityHealth.isLoading}
          color="#60A5FA"
        />
      </ChartSection>

      <ChartSection title="Phantom drain" description="SOC lost while parked per day">
        <BarChart
          data={phantomDrain.data ?? []}
          xKey="day"
          bars={[{ dataKey: 'total_soc_lost', label: 'SOC lost (%)', color: '#A78BFA' }]}
          loading={phantomDrain.isLoading}
        />
      </ChartSection>
    </PageLayout>
  );
}
```

### packages/ui/src/primitives/StatCard.tsx

```tsx
import React from 'react';
import { cn } from '../lib/utils';
import { Skeleton } from './Skeleton';

export interface StatCardProps {
  label:    string;
  value:    string | number;
  unit?:    string;
  delta?:   { value: number; label: string; direction: 'up' | 'down' | 'neutral' };
  icon?:    React.ReactNode;
  loading?: boolean;
  color?:   'default' | 'green' | 'amber' | 'blue' | 'red';
  size?:    'sm' | 'md' | 'lg';
  className?: string;
}

const colorMap = {
  default: 'text-text-primary',
  green:   'text-brand-green-500',
  amber:   'text-charging-active',
  blue:    'text-charging-ac',
  red:     'text-soc-low',
};

export function StatCard({
  label, value, unit, delta, icon, loading, color = 'default', size = 'md', className,
}: StatCardProps) {
  if (loading) {
    return (
      <div className={cn('bg-surface-elevated border border-border-default rounded-xl p-4', className)}>
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  const valueSize = { sm: 'text-2xl', md: 'text-3xl', lg: 'text-4xl' }[size];

  return (
    <div className={cn(
      'bg-surface-elevated border border-border-default rounded-xl p-4',
      'transition-colors hover:border-border-strong',
      className
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          {label}
        </span>
        {icon && <span className="text-text-tertiary">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-bold tabular-nums', valueSize, colorMap[color])}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {unit && (
          <span className="text-sm text-text-secondary">{unit}</span>
        )}
      </div>

      {delta && (
        <div className={cn('mt-2 flex items-center gap-1 text-xs', {
          'text-brand-green-500': delta.direction === 'up',
          'text-soc-low':         delta.direction === 'down',
          'text-text-tertiary':   delta.direction === 'neutral',
        })}>
          <span>{delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→'}</span>
          <span>{delta.value > 0 ? '+' : ''}{delta.value.toFixed(1)}%</span>
          <span className="text-text-tertiary">{delta.label}</span>
        </div>
      )}
    </div>
  );
}
```

### packages/ui/src/primitives/Skeleton.tsx

```tsx
import { cn } from '../lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn(
      'animate-pulse rounded bg-border-default',
      className
    )} />
  );
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-xl bg-surface-elevated border border-border-default"
      style={{ height }}
    >
      <div className="h-full flex items-end gap-2 p-4 pb-8">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-border-default"
            style={{ height: `${20 + Math.sin(i * 0.8) * 30 + 30}%` }}
          />
        ))}
      </div>
    </div>
  );
}
```

### packages/ui/src/primitives/PageLayout.tsx

```tsx
import React from 'react';
import { cn } from '../lib/utils';

interface PageLayoutProps {
  title:       string;
  subtitle?:   string;
  headerRight?: React.ReactNode;
  children:    React.ReactNode;
  className?:  string;
}

export function PageLayout({ title, subtitle, headerRight, children, className }: PageLayoutProps) {
  return (
    <div className={cn('p-6 lg:p-8 max-w-[1400px] mx-auto', className)}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
          {subtitle && (
            <p className="text-sm text-text-secondary mt-1">{subtitle}</p>
          )}
        </div>
        {headerRight && <div className="flex items-center gap-3">{headerRight}</div>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

interface ChartSectionProps {
  title:        string;
  description?: string;
  children:     React.ReactNode;
  action?:      React.ReactNode;
}

export function ChartSection({ title, description, children, action }: ChartSectionProps) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {description && (
            <p className="text-xs text-text-secondary mt-0.5">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {children}
    </div>
  );
}
```

---

## 20. Complete pnpm Workspace & Turbo Config

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs":    ["$TURBO_DEFAULT$", ".env.*"],
      "outputs":   ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs":   ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["build"]
    },
    "dev": {
      "cache":     false,
      "persistent":true
    },
    "storybook": {
      "cache":     false,
      "persistent":true
    }
  }
}
```

### package.json (root)

```json
{
  "name":    "rivianmate",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20", "pnpm": ">=9" },
  "scripts": {
    "dev":       "turbo dev",
    "build":     "turbo build",
    "test":      "turbo test",
    "lint":      "turbo lint",
    "typecheck": "turbo typecheck",
    "storybook": "turbo storybook",
    "clean":     "turbo clean && rm -rf node_modules",
    "db:migrate":"cd apps/api && sqlx migrate run",
    "db:reset":  "cd apps/api && sqlx database drop && sqlx database create && sqlx migrate run"
  },
  "devDependencies": {
    "turbo":  "^2.0.0",
    "prettier":"^3.3.0"
  }
}
```

---

## 21. Agent Quickstart Commands

Run these in order to bootstrap the project from scratch:

```bash
# 1. Clone and install
git init rivianmate && cd rivianmate
pnpm init

# 2. Create workspace config (paste from Section 20)
# Create pnpm-workspace.yaml and turbo.json and root package.json

# 3. Create directory structure
mkdir -p apps/{web,mobile,api/src/{routes,db,ingestion,middleware,models},api/migrations,api/tests}
mkdir -p packages/{ui/src/{tokens,charts,primitives,tables,lib},hooks/src,types/src,config/{eslint,typescript,tailwind}}
mkdir -p infra/grafana/provisioning/datasources
mkdir -p .github/workflows

# 4. Install tooling
pnpm add -Dw turbo prettier

# 5. Initialize Rust API
cd apps/api
cargo init --name rivianmate-api
# Paste Cargo.toml from Section 17

# 6. Start local infrastructure
cd ../../infra
docker compose up -d

# 7. Run migrations
cd ../apps/api
sqlx database create
sqlx migrate run

# 8. Verify DB schema
psql postgresql://rivianmate:devpassword@localhost:5432/rivianmate \
  -c "\dt timeseries.*" -c "\dt rivianmate.*"

# 9. Initialize web app
cd ../web
pnpm create vite . --template react-ts
# Paste package.json from Section 19 and run:
pnpm install

# 10. Initialize Storybook
pnpm dlx storybook@latest init

# 11. Run everything
cd ../..
pnpm dev
```

### First files to write (in order)

1. `packages/ui/src/tokens/colors.ts` — paste from Section 8
2. `packages/ui/src/tokens/globals.css` — paste CSS variables from Section 8
3. `packages/config/tailwind/base.ts` — paste from Section 8
4. `apps/web/tailwind.config.ts` — paste from Section 19
5. `packages/ui/src/primitives/Skeleton.tsx` — paste from Section 19
6. `packages/ui/src/primitives/StatCard.tsx` — paste from Section 19
7. `packages/ui/src/primitives/PageLayout.tsx` — paste from Section 19
8. `apps/api/src/models/telemetry.rs` — paste from Section 18
9. `apps/api/src/ingestion/parser.rs` — paste from Section 18
10. `apps/api/src/ingestion/trip_detector.rs` — paste from Section 18
11. `cargo test` — all parser and trip_detector tests must pass before continuing

---

*End of RivianMate Agent Build Specification v1.0*