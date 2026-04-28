# Riviamigo — Agent Build Specification Addendum (v0)

> **Read order:** Read `riviamigo_agent_specs.md` first as conceptual reference, then this addendum as the **authoritative implementation guide**. **Where the two conflict, this document wins.** Where this document is silent, follow the original spec.

---

## 0. Canonical Naming & Precedence

### 0.1 Names (locked)

| Concept | Canonical | Notes |
|---|---|---|
| Project / app name | **Riviamigo** | Replace every "RivianMate" reference. |
| Pretty / brand label | **Riviamigo** | Used in nav header, page title, marketing. |
| pnpm scope | `@riviamigo/*` | `@riviamigo/web`, `@riviamigo/ui`, `@riviamigo/hooks`, `@riviamigo/types`, `@riviamigo/config`. |
| Rust binary | `riviamigo-api` | `apps/api/Cargo.toml`. |
| Postgres DB / role | `riviamigo` | `docker-compose.yml` env. |
| App schema | `riviamigo` | `CREATE SCHEMA riviamigo` (replaces `rivianmate`). |
| Time-series schema | `timeseries` | Unchanged. |
| JWT issuer claim | `riviamigo` | |
| Log target prefix | `riviamigo_api` | `RUST_LOG=riviamigo_api=debug`. |

If you find any `rivianmate` / `RivianMate` string while implementing, rename it. The original spec is wrong on naming.

### 0.2 Precedence rules

1. This addendum > `riviamigo_agent_specs.md`.
2. Concrete code in this addendum > prose in either document.
3. The "v0 scope cuts" in §1.2 are absolute — do not implement deferred items even if the original spec describes them.

---

## 1. Phasing & v0 Scope

### 1.1 Phases

| Phase | Name | Scope summary |
|---|---|---|
| **v0** (this build) | Riviamigo Core | PWA-friendly responsive web. Single-vehicle per user (schema multi-vehicle, UI single). Battery / Trips / Charging / Efficiency dashboards. Live WS status. |
| v0.5 | Power-user features | Multi-vehicle UI, data export (CSV/GPX), Grafana SimpleJSON datasource endpoint, email alerts on phantom drain. |
| v1 | Mobile native | `apps/mobile` Expo app sharing `packages/hooks` and `packages/types`. Push notifications. |
| v1+ | Beyond | Trip cost analytics with weather enrichment, charger network favorites, route planning. |

### 1.2 v0 cuts (do NOT implement)

- ❌ `apps/mobile/` — directory not created, package not added to `pnpm-workspace.yaml`.
- ❌ Grafana endpoints (`/grafana/query`, `/grafana/search`) — but reserve the route module (`apps/api/src/routes/grafana.rs`) returning `501 Not Implemented` so the path is wired.
- ❌ CSV / GPX export endpoints and UI — but keep `MinIO` in `docker-compose.yml` so v0.5 can land without infra changes.
- ❌ Multi-vehicle picker UI — backend accepts `vehicle_id` query param on every `/v1/*` route, frontend always passes `auth.default_vehicle_id` from a `useDefaultVehicle()` hook.
- ❌ Email alerts, push notifications.
- ❌ The `apps/web/src/routes/settings/index.tsx` page beyond a stub — settings only needs: change electricity rate, change distance/temp units, view connection status. Nothing else.

### 1.3 v0 architectural decisions kept "Grafana-friendly"

To avoid refactoring when Grafana lands in v0.5:
- API key auth scaffolding lives next to JWT auth (separate middleware, separate header `X-Riviamigo-API-Key`). v0 issues no keys — just leave the middleware module empty.
- All time-series endpoints use the **same SQL queries** Grafana will use, exposed via JSON. Grafana's adapter will be a thin reformatter, not a separate query path.
- `vehicle_id` is always a query parameter, never a path segment. Grafana's SimpleJSON sends it as a target argument; URL parity matters.

---

## 2. Critical Gap Resolutions

### 2.1 Auth model — JWT contract & vehicle scoping

**JWT claims (RS256, 15-min access tokens):**

```json
{
  "iss": "riviamigo",
  "sub": "<user_id uuid>",
  "exp": 1234567890,
  "iat": 1234567875,
  "default_vehicle_id": "<uuid|null>"
}
```

`default_vehicle_id` is included on issue for client convenience. The server **does not trust it** — it re-reads from the DB on every request that touches vehicle data.

**Refresh tokens (opaque, 30-day):**

```sql
-- migration 0001 addition
CREATE TABLE riviamigo.refresh_tokens (
  token_hash  BYTEA PRIMARY KEY,           -- SHA-256 of opaque token
  user_id     UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX ON riviamigo.refresh_tokens (user_id) WHERE revoked_at IS NULL;
```

Client stores access token in memory (Zustand) and refresh token in `httpOnly Secure SameSite=Strict` cookie. Logout revokes the refresh token row.

**`AuthUser` extractor (Rust):**

```rust
// src/middleware/auth.rs
pub struct AuthUser {
    pub user_id: Uuid,
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = AppError;
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Extract Bearer token, verify RS256 against config.jwt_public_key,
        // assert iss == "riviamigo", return AuthUser { user_id: claims.sub }.
    }
}
```

**Vehicle scoping helper (used by every `/v1/*` data route):**

```rust
// src/db/vehicles.rs
pub async fn require_vehicle_owned(
    pool:       &PgPool,
    user_id:    Uuid,
    vehicle_id: Uuid,
) -> Result<(), AppError> {
    let owns = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM riviamigo.vehicles WHERE id = $1 AND user_id = $2)",
        vehicle_id, user_id,
    ).fetch_one(pool).await?.unwrap_or(false);
    if !owns { return Err(AppError::Forbidden); }
    Ok(())
}
```

**Every data endpoint pattern:**

```rust
async fn get_soc(
    State(pool): State<PgPool>,
    auth:        AuthUser,
    Query(p):    Query<TimeRangeParams>,
) -> Result<Json<Vec<TimeSeriesPoint>>, AppError> {
    let vehicle_id = p.vehicle_id.ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&pool, auth.user_id, vehicle_id).await?;
    // ...query keyed on vehicle_id...
}
```

**`TimeRangeParams` (canonical shape):**

```rust
#[derive(Debug, Deserialize)]
pub struct TimeRangeParams {
    pub vehicle_id: Option<Uuid>,           // required at runtime; Option for better 422 message
    pub from:       Option<DateTime<Utc>>,
    pub to:         Option<DateTime<Utc>>,
}
```

### 2.2 Auth route contracts

```
POST /auth/register  body: { email, password }         → 201 { user_id }
POST /auth/login     body: { email, password }         → 200 { access_token, expires_in }; sets refresh cookie
POST /auth/refresh   (refresh cookie present)          → 200 { access_token, expires_in }
POST /auth/logout    (refresh cookie present)          → 204; revokes refresh row, clears cookie
GET  /auth/me        (Bearer)                          → 200 { user_id, email, default_vehicle_id }
```

Password hashing: `argon2id` with `m=19456, t=2, p=1` (OWASP 2023 minimum). Use `argon2::Argon2::default()` for v0 — defaults match.

Rate limiting (tower-governor): `/auth/*` = 10 req/min per IP. `/v1/*` = 100 req/min per `user_id` (pulled from validated JWT in middleware order).

### 2.3 Rivian connect flow (multi-step, OTP-aware)

Three endpoints, all under `/vehicles`:

```
POST /vehicles/connect
  body: { email, password }
  responses:
    200 { status: "connected", vehicles: [{ rivian_vehicle_id, vin, model, trim, ... }] }
    202 { status: "otp_required", challenge_id: "<opaque>" }
    401 { status: "invalid_credentials" }

POST /vehicles/connect/otp
  body: { challenge_id, otp_code }
  responses:
    200 { status: "connected", vehicles: [...] }
    401 { status: "invalid_otp" }

POST /vehicles
  body: { rivian_vehicle_id, name?, home_lat?, home_lng? }
  response: 201 { vehicle_id }
  side effects: writes vehicle_credentials row (encrypted with age),
                spawns ingestion worker, sets users.default_vehicle_id if null.
```

`challenge_id` is a Redis key (`rivian:otp:<random>`) holding the in-flight Rivian login state for 5 minutes.

The Rivian login request bodies and headers are documented in the original spec §4. Implementation in `src/ingestion/rivian_auth.rs`:

```rust
pub struct RivianTokens {
    pub a_sess:     String,
    pub u_sess:     String,
    pub csrf_token: String,
    pub created_at: DateTime<Utc>,
}

pub enum LoginResult {
    Authenticated(RivianTokens),
    OtpRequired { challenge: RivianOtpChallenge },
}

pub async fn rivian_login(email: &str, password: &str) -> Result<LoginResult, RivianAuthError>;
pub async fn rivian_login_otp(challenge: RivianOtpChallenge, code: &str) -> Result<RivianTokens, RivianAuthError>;
```

`RivianOtpChallenge` carries the `otp_token` and `session_id` returned by Rivian — opaque to us, serialized into the Redis blob.

### 2.4 Backend live-status WebSocket (fanout)

**Endpoint:** `GET /v1/vehicles/live?vehicle_id=<uuid>`

- Standard HTTP/1.1 Upgrade handshake.
- JWT supplied via `Sec-WebSocket-Protocol: bearer.<jwt>` (browsers can't set custom headers on WS). Server reads, validates, and echoes `bearer` back as the selected subprotocol.
- After handshake, server validates `vehicle_id` ownership.
- Server subscribes to Redis channel `vehicle:{vehicle_id}:status` and forwards each message verbatim.
- No client-to-server messages in v0 (read-only stream). Server pings every 30s; closes on missed pong.

**Message format (server → client):**

```json
{
  "type": "status",
  "ts": "2026-04-26T18:30:00Z",
  "data": {
    "battery_level": 82.5,
    "distance_to_empty_mi": 312.4,
    "power_state": "ready",
    "charger_state": "disconnected",
    "speed_mph": 0,
    "location": { "lat": 30.267, "lng": -97.743 },
    "is_online": true
  }
}
```

**Producer side:** the per-vehicle ingestion worker, after writing telemetry to TimescaleDB, also publishes a snapshot to `vehicle:{vehicle_id}:status` (Redis PUBLISH). Snapshot is the latest non-null value of each field, kept in-process by the worker.

**Redis topic naming convention (locked for v0.5/v1):**

```
vehicle:{vehicle_id}:status        # live status snapshots (PUBLISH)
vehicle:{vehicle_id}:health        # ingestion worker health (PUBLISH, future)
rivian:otp:{challenge_id}          # OTP challenge state (SET, EX 300)
ratelimit:user:{user_id}           # tower-governor counter (managed)
```

### 2.5 Ingestion worker lifecycle

**One Tokio task per vehicle row.** Owned by a `WorkerSupervisor` actor in `src/ingestion/supervisor.rs`.

```rust
pub struct WorkerSupervisor {
    pool:    PgPool,
    redis:   redis::Client,
    age_key: age::x25519::Identity,
    workers: HashMap<Uuid /* vehicle_id */, JoinHandle<()>>,
    cmd_rx:  mpsc::Receiver<SupervisorCommand>,
}

pub enum SupervisorCommand {
    StartWorker { vehicle_id: Uuid },
    StopWorker  { vehicle_id: Uuid },
    Shutdown,
}
```

**Startup (`main.rs`):**
1. `SELECT v.id FROM riviamigo.vehicles v JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id`
2. For each row, send `StartWorker { vehicle_id }` to the supervisor.

**On `POST /vehicles` success:** route handler sends `StartWorker { vehicle_id }` to the supervisor's command channel.

**Worker loop (`src/ingestion/worker.rs`):**

```
loop:
  decrypt tokens; if expired/missing → call rivian_login; on 401 mark
    vehicle_credentials.last_refreshed_at = NULL, publish health=needs_reauth, sleep 5min, retry
  open WS subscription
  spawn poller task (powerState-driven intervals from §4.2 of original spec)
  receive WS messages → parser → upsert telemetry row → update in-memory snapshot →
    PUBLISH vehicle:{id}:status → feed trip_detector → on TripEvent::TripEnded
    persist trip + track via db::trips::insert_completed_trip
  on WS disconnect → exponential backoff (1, 2, 4, 8, max 60s) → reconnect
  on graceful shutdown signal → drain → close
```

**Worker health publish** (skeleton for v0.5; just log in v0):

```rust
enum WorkerHealth { Connected, Reconnecting, NeedsReauth(String) }
```

### 2.6 Charge session boundary detection

State machine in `src/ingestion/charge_detector.rs`, owned by the worker alongside `TripDetectorState`.

**Start condition:** `charger_state` transitions `Disconnected → Connected` OR `Connected → Charging`.

**End condition:** `charger_state` becomes `Disconnected` OR `Done`, OR no charger event in 30 minutes while last state was `Charging`.

**On end, emit `ChargeSessionEnded`:**

```rust
pub struct CompletedChargeSession {
    pub vehicle_id:   Uuid,
    pub started_at:   DateTime<Utc>,
    pub ended_at:     DateTime<Utc>,
    pub location:     Option<LatLng>,        // first non-null gnssLocation in window
    pub soc_start:    Option<f64>,
    pub soc_end:      Option<f64>,
    pub charge_limit: Option<f64>,
    pub max_kw:       Option<f64>,           // computed below
    pub charger_type: Option<String>,        // AC | DC | DCFC, derived in §3.6
    pub kwh_added:    Option<f64>,           // filled by reconciliation
    pub rivian_session_id: Option<String>,   // filled by reconciliation
}
```

**Persistence flow:**
1. Worker inserts the row into `riviamigo.charge_sessions` immediately on detection.
2. After insert, worker calls `rivian_api::get_completed_session_summaries()` (one Rivian poll). Reconciliation logic:
   - Match by overlapping `(started_at, ended_at)` ± 5 min.
   - On match, `UPDATE` the row to set `kwh_added`, `rivian_session_id`, finalize `max_charge_rate_kw`.
   - If no match within 10 minutes, schedule one retry. If still no match, leave `kwh_added = NULL` (UI shows "syncing…").
3. Unique index on `rivian_session_id` (nullable, partial) prevents double-write:
   ```sql
   CREATE UNIQUE INDEX ON riviamigo.charge_sessions(rivian_session_id)
     WHERE rivian_session_id IS NOT NULL;
   ```

**Charge curve generation** is computed at API request time, not at ingest. See §3.4.

### 2.7 v0 scope reconfirmation (anti-drift)

The frontend renders ONE vehicle. The endpoint shape supports many. Sonnet should not build a vehicle picker. Sonnet should not show a "select vehicle" empty state. The `useDefaultVehicle()` hook returns the JWT's `default_vehicle_id`; if null, the app shows the onboarding wizard (`/connect`).

---

## 3. Tactical Gap Fills

### 3.1 Migration 0005 — indexes (replaces empty original)

```sql
-- apps/api/migrations/0005_indexes.sql
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id
  ON riviamigo.vehicles(user_id);

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started
  ON riviamigo.trips(vehicle_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_charge_sessions_vehicle_started
  ON riviamigo.charge_sessions(vehicle_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_sessions_rivian_session
  ON riviamigo.charge_sessions(rivian_session_id)
  WHERE rivian_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_charger
  ON timeseries.telemetry(vehicle_id, charger_state, ts DESC)
  WHERE charger_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON riviamigo.refresh_tokens(user_id) WHERE revoked_at IS NULL;
```

### 3.2 Migration 0006 — runtime state (new)

```sql
-- apps/api/migrations/0006_runtime_state.sql
CREATE TABLE riviamigo.vehicle_runtime_state (
  vehicle_id        UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  is_online         BOOLEAN,
  last_event_at     TIMESTAMPTZ,
  worker_health     TEXT,                                  -- connected | reconnecting | needs_reauth
  worker_health_msg TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Worker upserts this once per minute. The `GET /vehicles/:id/status` cached endpoint reads from here when the WS isn't connected.

### 3.3 Stats summary endpoint

```
GET /v1/stats/summary?vehicle_id=<uuid>
→ 200 {
    total_miles:                12345.6,
    total_trips:                234,
    total_kwh_charged:          4567.8,
    lifetime_efficiency_wh_mi:  385.2,
    total_charging_sessions:    89,
    estimated_total_cost_usd:   593.81
  }
```

SQL (single query, cached 5 min in Redis as `stats:{vehicle_id}`):

```sql
SELECT
  COALESCE(SUM(t.distance_miles), 0)                         AS total_miles,
  COUNT(t.id)                                                AS total_trips,
  COALESCE((SELECT SUM(kwh_added)
              FROM riviamigo.charge_sessions
              WHERE vehicle_id = $1), 0)                     AS total_kwh_charged,
  CASE WHEN SUM(t.distance_miles) > 0
       THEN SUM(t.distance_miles * t.efficiency_wh_per_mile) / SUM(t.distance_miles)
       ELSE NULL END                                         AS lifetime_efficiency_wh_mi,
  (SELECT COUNT(*) FROM riviamigo.charge_sessions
     WHERE vehicle_id = $1)                                  AS total_charging_sessions,
  (SELECT COALESCE(SUM(kwh_added), 0) *
            COALESCE((SELECT electricity_rate_per_kwh
                        FROM riviamigo.user_preferences
                        WHERE user_id = $2), 0.13)
     FROM riviamigo.charge_sessions
     WHERE vehicle_id = $1)                                  AS estimated_total_cost_usd
FROM riviamigo.trips t
WHERE t.vehicle_id = $1;
```

The `_formatted` keys the frontend expects (`total_miles_formatted`, etc.) are produced **client-side** in the `useSummaryStats` hook from these raw numbers. The backend ships raw values only.

### 3.4 Charging endpoints

```
GET /v1/charging/sessions?vehicle_id&from&to&limit&offset
→ Paginated list: [{ id, started_at, ended_at, location: {lat,lng,is_home},
                     kwh_added, soc_start, soc_end, charger_type, duration_minutes,
                     cost_usd, max_charge_rate_kw }]

GET /v1/charging/sessions/:id?vehicle_id=<uuid>
→ Session detail: same fields + curve: ChargeCurvePoint[]

GET /v1/charging/summary?vehicle_id&from&to
→ {
    total_kwh: number,
    total_cost_usd: number,
    session_count: number,
    home_kwh: number,
    away_kwh: number,
    by_type: { ac_kwh, dc_kwh, dcfc_kwh },
    weekly: [{ week_start, kwh, sessions }]
  }
```

**Charge curve query** (computed at request time from `telemetry_1min` over the session window):

```sql
WITH samples AS (
  SELECT bucket,
         avg_soc,
         max(battery_capacity_wh) OVER (PARTITION BY vehicle_id) AS cap_wh
  FROM timeseries.telemetry_1min
  WHERE vehicle_id = $1
    AND bucket >= $2 AND bucket <= $3
)
SELECT
  EXTRACT(EPOCH FROM (bucket - $2)) / 60.0  AS minutes_elapsed,
  60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
       * cap_wh / 1000.0                    AS charge_rate_kw,
  avg_soc                                   AS soc
FROM samples
ORDER BY bucket;
```

Filter out the first row (LAG null) and any negative `charge_rate_kw` (regen/sampling artifacts) in the handler.

**Home vs away flag:** computed at session insert time, stored in `is_home`. Logic: haversine distance from `vehicles.home_latitude/longitude` < 0.05 miles → `true`. If home unset, `NULL`.

**Charger type derivation** (worker, on session end):
- Look at the median of `time_to_end_of_charge_min`-implied power during the session: `(soc_end − soc_start)/100 × battery_capacity_wh / duration_h`.
- `< 12 kW` → `AC`. `12–50 kW` → `DC`. `>= 50 kW` → `DCFC`. Override with `getCompletedSessionSummaries.chargerType` if present.

### 3.5 Efficiency endpoints

```
GET /v1/efficiency/summary?vehicle_id&from&to
→ { avg_wh_per_mi, total_miles, total_kwh, p10_wh_per_mi, p90_wh_per_mi }

GET /v1/efficiency/by-mode?vehicle_id&from&to
→ [{ drive_mode, trip_count, total_miles, avg_wh_per_mi }]

GET /v1/efficiency/range-vs-temp?vehicle_id&from&to
→ [{ trip_id, distance_miles, efficiency_wh_per_mi, avg_temp_c }]   // raw scatter points
```

All from `riviamigo.trips` joined to `telemetry_1hr.avg_cabin_temp_c` over the trip window. If `outside_temp_c` becomes available later (weather enrichment), prefer it over cabin temp.

### 3.6 Trip persistence

`src/db/trips.rs::insert_completed_trip` writes the trip row + (optionally) downsampled track rows. The track is **read back** from `timeseries.telemetry` at request time, not stored separately. This keeps writes idempotent and lets us re-derive tracks if downsampling rules change.

```rust
pub async fn insert_completed_trip(
    pool:     &PgPool,
    vehicle_id: Uuid,
    completed: &CompletedTripData,
    soc_end:    Option<f64>,
    fallback_capacity_wh: Option<f64>,    // from vehicles.battery_capacity_wh
) -> Result<Uuid, AppError> {
    let distance = compute_distance_miles(&completed.points);
    if distance < MIN_TRIP_DISTANCE_MILES { return Err(AppError::Validation("micro-trip".into())); }
    let max_speed = completed.points.iter().map(|p| p.speed_mph).fold(0.0, f64::max);
    let cap_wh = completed.battery_capacity_wh.or(fallback_capacity_wh);
    let efficiency = match (completed.soc_start, soc_end, cap_wh) {
        (Some(s0), Some(s1), Some(cap)) if distance > 0.0 && s0 > s1
            => Some(((s0 - s1) / 100.0) * cap / distance),
        _   => None,
    };
    // INSERT ... RETURNING id
}
```

### 3.7 GPS track endpoint downsampling

```
GET /v1/trips/:id/track?vehicle_id=<uuid>
```

Decision rule based on trip duration (read from `trips`):

```
duration < 15 min   → return raw points from telemetry
15 ≤ duration < 60  → time_bucket('5 seconds', ts), avg(lat,lng,speed)
duration ≥ 60       → time_bucket('15 seconds', ts), avg(lat,lng,speed)
```

Cap at 5,000 points per response regardless of bucket. If exceeded, increase bucket size by 2× and re-query.

### 3.8 Phantom-drain MV refresh

Schedule via a Tokio interval task in `main.rs`, not pg_cron (keeps infra requirements minimal):

```rust
tokio::spawn(async move {
    let mut tick = tokio::time::interval(Duration::from_secs(3600)); // hourly
    loop {
        tick.tick().await;
        let _ = sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY timeseries.phantom_drain_periods")
            .execute(&pool).await;
        let _ = sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY timeseries.phantom_drain_daily")
            .execute(&pool).await;
    }
});
```

`CONCURRENTLY` requires the unique index already declared in original spec migration 0004. Keep them.

### 3.9 Hooks signature alignment

Resolves the `useBattery(vehicleId, range)` vs `useBattery(range)` conflict. **Canonical:**

```typescript
// packages/hooks/src/useBattery.ts
export function useBattery(range: DateRange) {
  const vehicleId = useDefaultVehicleId();   // throws if null; pages are gated by <RequireVehicle>
  // ...returns { soc, range: rangeEstimate, capacityHealth, phantomDrain, isLoading, isError }
}
```

`useDefaultVehicleId` reads from the auth store. Pages mount inside `<RequireVehicle>` which redirects to `/connect` if null. This means hooks never see a null `vehicleId`.

### 3.10 `PageLayout.tsx` is a primitive

Add to `packages/ui/src/primitives/`:
- `PageLayout` (already specced in §19 of original)
- `ChartSection` (ditto)
- `StatCardGrid` (ditto)

Update §3 directory tree mentally: `primitives/PageLayout.tsx` exists, exported from `primitives/index.ts`.

### 3.11 No hardcoded hex in pages

The original §19 example uses `color="#60A5FA"`. Replace with token reference:

```tsx
import { dataViz } from '@riviamigo/ui/tokens';
<AreaChart color={dataViz.blue} ... />
```

`dataViz` exported as a named object (see §4.5 below) so chart consumers reference by semantic name (`dataViz.amber`, `dataViz.blue`) instead of array index.

### 3.12 Storybook config

Both `packages/ui/.storybook/main.ts` and `preview.ts` are required. Concrete bodies:

```typescript
// packages/ui/.storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons:  ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  docs: { autodocs: 'tag' },
};
export default config;
```

```typescript
// packages/ui/.storybook/preview.ts
import type { Preview } from '@storybook/react';
import { ChartProvider } from '../src/charts/ChartProvider';
import '../src/tokens/globals.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0A0A0F' },
        { name: 'light', value: '#FAFAF7' },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: 'Color theme',
      defaultValue: 'dark',
      toolbar: {
        title: 'Theme',
        items: [{ value: 'dark', title: 'Dark' }, { value: 'light', title: 'Light' }],
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      const theme = ctx.globals.theme;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark',  theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
      }
      return <ChartProvider><Story /></ChartProvider>;
    },
  ],
};
export default preview;
```

### 3.13 Cryptographic key initialization

**Auto-generation on first boot:**

The API automatically generates the following keys on first container startup and persists them in the `system_config` database table:
1. RSA-2048 keypair (JWT signing) → `jwt_private_key`, `jwt_public_key` columns
2. age X25519 identity (Rivian token encryption) → `age_key` column

**No manual keygen needed.** Just start the container; keys are generated and persisted within the first few seconds. The database volume ensures they survive restarts.

**Production key override:**

To use externally-managed or rotated keys:

```bash
# Generate your own RSA keypair (optional)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt_private.pem
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem

# Generate your own age identity (optional)
age-keygen

# Pass to the API container via environment variables
docker compose -f infra/docker-compose.yml up -d --build \
  -e JWT_SECRET="$(cat jwt_private.pem)" \
  -e JWT_PUBLIC_KEY="$(cat jwt_public.pem)" \
  -e AGE_ENCRYPTION_KEY="AGE-SECRET-KEY-..."
```

Environment variables always override the database values. Omit them to use auto-generated keys.

### 3.14 Rate limiting wiring

```rust
// src/middleware/rate_limit.rs
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};

pub fn auth_limiter() -> GovernorLayer<...> {
    let config = GovernorConfigBuilder::default()
        .per_second(0.16) // ~10/min
        .burst_size(10)
        .finish().unwrap();
    GovernorLayer { config: Box::leak(Box::new(config)) }
}

pub fn data_limiter() -> GovernorLayer<...> {
    let config = GovernorConfigBuilder::default()
        .per_second(1.6) // ~100/min
        .burst_size(20)
        .key_extractor(JwtUserIdExtractor) // custom — pulls `sub` from already-validated JWT
        .finish().unwrap();
    GovernorLayer { config: Box::leak(Box::new(config)) }
}
```

Apply: `auth_limiter()` to `/auth` router, `data_limiter()` to the `/v1` nested router (after auth middleware so the JWT is already verified).

### 3.15 Security headers

```rust
// src/middleware/security.rs — applied at root router
SetResponseHeaderLayer::overriding(header::STRICT_TRANSPORT_SECURITY,    "max-age=31536000; includeSubDomains")
SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS,        "nosniff")
SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS,               "DENY")
SetResponseHeaderLayer::overriding(header::REFERRER_POLICY,               "no-referrer")
SetResponseHeaderLayer::overriding(header::CONTENT_SECURITY_POLICY,
  "default-src 'self'; img-src 'self' data: https://*.basemaps.cartocdn.com https://*.protomaps.com; \
   style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss://*.riviamigo.local; \
   font-src 'self' data:; frame-ancestors 'none'")
```

Adjust `connect-src` host for prod deployment.

### 3.16 Worker bootstrap from `main.rs`

```rust
async fn main() -> anyhow::Result<()> {
    // ...config + pool + migrations...
    sqlx::migrate!("./migrations").run(&pool).await?;

    // Auto-generate or load keys from DB
    let active_keys = crate::keys::bootstrap_keys(
        &pool,
        config.jwt_secret.clone(),
        config.jwt_public_key.clone(),
        config.age_encryption_key.clone(),
    ).await?;

    let jwt_keys = Arc::new(
        JwtKeys::new(&active_keys.jwt_private_pem, &active_keys.jwt_public_pem)?
    );

    let redis = redis::Client::open(config.redis_url.clone())?;
    let age_key = active_keys.age_key;

    let state = AppState {
        pool: pool.clone(),
        redis: redis.clone(),
        jwt_keys,
        age_key: age_key.clone(),
        config: config.clone(),
    };

    // Start ingestion workers
    let _supervisor = ingestion::start_workers(
        pool.clone(), redis, age_key, config.clone(),
    ).await?;

    // Bootstrap workers for all enrolled vehicles
    let enrolled: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT v.id FROM riviamigo.vehicles v
           JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id"
    ).fetch_all(&pool).await?;
    for vid in enrolled {
        // Workers are auto-started by supervisor
    }

    // Phantom-drain refresh cron (§3.8)
    spawn_phantom_drain_refresh(pool.clone());

    // ...build router with state, serve...
}
```

### 3.17 WebSocket subscription GraphQL document

Inline in `src/ingestion/ws_client.rs` as a const string. (Cribbed from HASS reference; full field set listed in original §4.)

```graphql
subscription VehicleState($vehicleID: ID!) {
  vehicleState(id: $vehicleID) {
    cloudConnection { isOnline lastSync }
    powerState         { timeStamp value }
    chargerState       { timeStamp value }
    chargerStatus      { timeStamp value }
    timeToEndOfCharge  { timeStamp value }
    batteryLevel       { timeStamp value }
    batteryCapacity    { timeStamp value }
    batteryLimit       { timeStamp value }
    distanceToEmpty    { timeStamp value }
    gnssLocation       { timeStamp latitude longitude }
    gnssSpeed          { timeStamp value }
    gnssAltitude       { timeStamp value }
    gnssBearing        { timeStamp value }
    driveMode          { timeStamp value }
    gearStatus         { timeStamp value }
    vehicleMileage     { timeStamp value }
    cabinClimateInteriorTemperature { timeStamp value }
    cabinClimateDriverTemperature   { timeStamp value }
    batteryHvThermalEvent           { timeStamp value }
    twelveVoltBatteryHealth         { timeStamp value }
  }
}
```

`cloudConnection.isOnline` writes through to `vehicle_runtime_state.is_online`.

### 3.18 ChartProvider theme application to Recharts

Recharts components don't read context. Each chart in `packages/ui/src/charts/*` accepts theme via `useChartTheme()` and forwards explicit props to Recharts (`stroke`, `fill`, `tickStroke`, etc.). Pattern:

```tsx
export function AreaChart(props: AreaChartProps) {
  const t = useChartTheme();
  // use t.gridColor, t.tickColor, t.fontFamily, t.colors[0], etc.
}
```

The `ChartProvider` only injects values; consumption is opt-in per chart.

### 3.19 CORS allowed origins

```rust
// dev: read from config; prod: locked
let cors = CorsLayer::new()
    .allow_origin(config.allowed_origins.iter().map(|o| o.parse().unwrap()).collect::<Vec<_>>())
    .allow_methods([Method::GET, Method::POST, Method::DELETE])
    .allow_headers([CONTENT_TYPE, AUTHORIZATION])
    .allow_credentials(true);   // needed for refresh cookie
```

`config.allowed_origins` defaults to `["http://localhost:3000"]` in dev.

---

## 4. Design System — Replaces Original §8 Entirely

> The original spec's emerald-green palette is **superseded**. Riviamigo's brand is amber-on-slate, "Minimalist Dark" (Linear/Raycast/Vercel feel), with a paired warm-light variant. Every visual decision in this section overrides §8 of the original spec.

### 4.1 Personality (locked)

- **Atmospheric, sophisticated, calm.** Not pure black; layered slates with one warm amber accent.
- **Dark is canonical;** light is a faithful translation, not an inversion.
- **Glass-effect cards** (semi-transparent + backdrop blur), low-opacity borders, ambient glow on focal elements.
- **Geometric sans:** Space Grotesk for display, Inter for body, JetBrains Mono for numeric/data labels.
- **Generous spacing.** Dashboards breathe; charts have headroom.

### 4.2 Core color tokens

```typescript
// packages/ui/src/tokens/colors.ts
export const colors = {
  // ── Brand accent (single warm color, both themes) ─────────────────────────
  accent: {
    50:  '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#F59E0B',   // PRIMARY — buttons, focus rings, active charging glow
    600: '#D97706',   // light mode preferred — better contrast on light bg
    700: '#B45309',
    800: '#92400E',
    900: '#78350F',
  },

  // ── Slate / neutral scale ─────────────────────────────────────────────────
  slate: {
    50:  '#FAFAF7',   // light bg page (warm off-white, not pure)
    100: '#F4F4EE',
    200: '#E5E5DD',
    300: '#D4D4C8',
    400: '#A1A1A1',
    500: '#71717A',   // secondary text (both themes)
    600: '#52525B',
    700: '#3F3F46',
    800: '#27272A',
    850: '#1A1A24',   // elevated surface (dark)
    900: '#12121A',   // surface (dark)
    950: '#0A0A0F',   // page (dark)
  },

  // ── Semantic — battery SOC ramp ───────────────────────────────────────────
  // Used by GaugeChart colorFn and StatCard color={...}
  soc: {
    high: '#10B981',   // > 60% — emerald
    mid:  '#F59E0B',   // 20–60% — amber (matches brand)
    low:  '#F87171',   // < 20% — rose, softer than red
  },

  // ── Semantic — charging states ────────────────────────────────────────────
  charging: {
    active:  '#F59E0B',   // amber — currently charging (pulse glow)
    done:    '#10B981',   // emerald — complete
    limited: '#F87171',   // rose — thermal limit / fault
    ac:      '#60A5FA',   // sky — AC charging
    dc:      '#A78BFA',   // violet — DC
    dcfc:    '#C084FC',   // brighter violet — DCFC
  },

  // ── Data viz palette (named, not array) ───────────────────────────────────
  // 8 distinct hues balanced for both dark slate and light off-white backgrounds.
  // Use semantic names in code (NEVER hex strings).
  dataViz: {
    amber:  '#F59E0B',
    sky:    '#60A5FA',
    emerald:'#10B981',
    violet: '#A78BFA',
    rose:   '#F87171',
    teal:   '#34D399',
    orange: '#FB923C',
    indigo: '#818CF8',
  },

  // ── Surface / text / border use CSS variables (theme-switched) ────────────
  bg: {
    page:     'var(--rm-bg-page)',
    surface:  'var(--rm-bg-surface)',
    elevated: 'var(--rm-bg-elevated)',
    glass:    'var(--rm-bg-glass)',          // semi-transparent card bg
    overlay:  'var(--rm-bg-overlay)',
  },
  text: {
    primary:   'var(--rm-text-primary)',
    secondary: 'var(--rm-text-secondary)',
    tertiary:  'var(--rm-text-tertiary)',
    disabled:  'var(--rm-text-disabled)',
    onAccent:  'var(--rm-text-on-accent)',   // text on amber buttons
  },
  border: {
    default: 'var(--rm-border-default)',
    strong:  'var(--rm-border-strong)',
    accent:  'var(--rm-border-accent)',
    focus:   '#F59E0B',
  },
} as const;

export type DataVizKey = keyof typeof colors.dataViz;
export const dataViz = colors.dataViz;
```

### 4.3 CSS variables — both themes

```css
/* packages/ui/src/tokens/globals.css */

:root, .dark {
  /* Dark is the default — applied to :root so SSR/no-JS shows dark */
  --rm-bg-page:        #0A0A0F;
  --rm-bg-surface:     #12121A;
  --rm-bg-elevated:    #1A1A24;
  --rm-bg-glass:       rgba(26, 26, 36, 0.6);
  --rm-bg-overlay:     rgba(0, 0, 0, 0.7);

  --rm-text-primary:   #FAFAFA;
  --rm-text-secondary: #A1A1A1;
  --rm-text-tertiary:  #71717A;
  --rm-text-disabled:  #52525B;
  --rm-text-on-accent: #0A0A0F;

  --rm-border-default: rgba(255, 255, 255, 0.08);
  --rm-border-strong:  rgba(255, 255, 255, 0.15);
  --rm-border-accent:  rgba(245, 158, 11, 0.3);

  --rm-glow-sm:        0 0 20px rgba(245, 158, 11, 0.15);
  --rm-glow-md:        0 0 40px rgba(245, 158, 11, 0.20);
  --rm-glow-lg:        0 0 60px rgba(245, 158, 11, 0.25);
  --rm-glow-button:    0 0 20px rgba(245, 158, 11, 0.40);

  --rm-accent:         #F59E0B;
  --rm-accent-hover:   #FBBF24;
  --rm-accent-active:  #D97706;
  --rm-accent-muted:   rgba(245, 158, 11, 0.15);

  --rm-shadow-sm:      0 1px 2px rgba(0, 0, 0, 0.3);
  --rm-shadow-md:      0 4px 6px rgba(0, 0, 0, 0.3);
  --rm-shadow-lg:      0 10px 15px rgba(0, 0, 0, 0.3);
  --rm-shadow-xl:      0 20px 25px rgba(0, 0, 0, 0.4);
}

.light {
  --rm-bg-page:        #FAFAF7;
  --rm-bg-surface:     #FFFFFF;
  --rm-bg-elevated:    #F4F4EE;
  --rm-bg-glass:       rgba(255, 255, 255, 0.7);
  --rm-bg-overlay:     rgba(20, 20, 24, 0.4);

  --rm-text-primary:   #18181B;
  --rm-text-secondary: #52525B;
  --rm-text-tertiary:  #71717A;
  --rm-text-disabled:  #A1A1A1;
  --rm-text-on-accent: #FAFAFA;            /* light text on darker amber-600 */

  --rm-border-default: rgba(20, 20, 24, 0.08);
  --rm-border-strong:  rgba(20, 20, 24, 0.18);
  --rm-border-accent:  rgba(217, 119, 6, 0.35);

  --rm-glow-sm:        0 0 0 1px rgba(217, 119, 6, 0.10);
  --rm-glow-md:        0 1px 2px rgba(217, 119, 6, 0.15);
  --rm-glow-lg:        0 2px 8px rgba(217, 119, 6, 0.20);
  --rm-glow-button:    0 4px 12px rgba(217, 119, 6, 0.25);

  --rm-accent:         #D97706;             /* amber-600 for light-mode contrast */
  --rm-accent-hover:   #B45309;
  --rm-accent-active:  #92400E;
  --rm-accent-muted:   rgba(217, 119, 6, 0.10);

  --rm-shadow-sm:      0 1px 2px rgba(20, 20, 24, 0.06);
  --rm-shadow-md:      0 2px 6px rgba(20, 20, 24, 0.08);
  --rm-shadow-lg:      0 8px 20px rgba(20, 20, 24, 0.10);
  --rm-shadow-xl:      0 16px 32px rgba(20, 20, 24, 0.12);
}

/* Optional: inherit OS preference for first-paint on cold cache */
@media (prefers-color-scheme: light) {
  :root:not(.dark):not(.light) {
    /* same vars as .light above — duplicated to support no-class default */
  }
}
```

**Theme application:** root element gets `class="dark"` or `class="light"`. Default (no class) = dark. Toggle persists in `localStorage("riviamigo-theme")` and is hydrated synchronously before React mounts (small inline `<script>` in `index.html`) to prevent FOUC.

### 4.4 Typography tokens

```typescript
// packages/ui/src/tokens/typography.ts
export const typography = {
  fonts: {
    display: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
    sans:    '"Inter Variable", "Inter", system-ui, sans-serif',
    mono:    '"JetBrains Mono Variable", "JetBrains Mono", "Fira Code", monospace',
  },
  sizes: {
    xs:   '0.75rem',
    sm:   '0.875rem',
    base: '1rem',
    lg:   '1.125rem',
    xl:   '1.25rem',
    '2xl':'1.5rem',
    '3xl':'2rem',
    '4xl':'2.5rem',
    '5xl':'3.5rem',
    '6xl':'4.5rem',
    '7xl':'6rem',
  },
  weights: { normal: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeights: { tight: '1.15', normal: '1.5', relaxed: '1.7' },
  tracking: {
    tight:  '-0.02em',   // headlines
    normal: '0',
    wide:   '0.025em',   // labels, mono
    wider:  '0.05em',    // tiny uppercase nav labels
  },
  numeric: '"tnum"',       // tabular-nums for stat displays
} as const;
```

**Usage rules:**
- Page titles, hero stats, chart headers → `font-display` (Space Grotesk).
- Body, cards, table cells → `font-sans` (Inter).
- Numeric stat values, timestamps, GPS coords, kWh / SOC / W/mi readouts → `font-mono` *or* `font-display` with `tabular-nums`. Pick mono for telemetry-heavy contexts (trip detail), display for hero stats.
- Sidebar nav labels → `text-xs font-medium tracking-wider uppercase`.

### 4.5 Spacing, radius, motion

```typescript
// packages/ui/src/tokens/spacing.ts
export const spacing = {
  px: '1px', 0.5: '0.125rem', 1: '0.25rem', 1.5: '0.375rem',
  2: '0.5rem', 3: '0.75rem', 4: '1rem', 5: '1.25rem',
  6: '1.5rem', 8: '2rem', 10: '2.5rem', 12: '3rem',
  16: '4rem', 20: '5rem', 24: '6rem', 32: '8rem',
} as const;

export const layout = {
  borderRadius: {
    sm:   '0.375rem',   // 6px — badges
    md:   '0.5rem',     // 8px — buttons, inputs (default)
    lg:   '0.75rem',    // 12px — cards (default)
    xl:   '1rem',       // 16px — large cards, modals
    '2xl':'1.5rem',     // 24px — hero / decorative
    full: '9999px',
  },
  shadows: {
    sm: 'var(--rm-shadow-sm)',
    md: 'var(--rm-shadow-md)',
    lg: 'var(--rm-shadow-lg)',
    xl: 'var(--rm-shadow-xl)',
  },
  glow: {
    sm:     'var(--rm-glow-sm)',
    md:     'var(--rm-glow-md)',
    lg:     'var(--rm-glow-lg)',
    button: 'var(--rm-glow-button)',
  },
  chartHeight: {
    sparkline: 64,
    compact:   200,
    default:   320,
    tall:      480,
    full:      640,
  },
  sidebar: {
    width:           256,   // px — desktop expanded
    widthCollapsed:  72,    // px — desktop collapsed (icons only)
    breakpoint:      'lg',  // below = drawer
  },
} as const;

export const motion = {
  duration: { fast: 150, base: 200, slow: 300, slower: 500 },
  easing:   {
    out:    'cubic-bezier(0.16, 1, 0.3, 1)',
    inOut:  'cubic-bezier(0.65, 0, 0.35, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;
```

### 4.6 Tailwind base config (replaces original §8 listing)

```typescript
// packages/config/tailwind/base.ts
import type { Config } from 'tailwindcss';
import { colors, layout, typography } from '@riviamigo/ui/tokens';

export const tailwindBase: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent:   colors.accent,
        slate:    colors.slate,
        soc:      colors.soc,
        charging: colors.charging,
        // Aliases that point at CSS variables (theme-switched)
        bg: {
          page:     'var(--rm-bg-page)',
          surface:  'var(--rm-bg-surface)',
          elevated: 'var(--rm-bg-elevated)',
          glass:    'var(--rm-bg-glass)',
        },
        fg: {
          DEFAULT:   'var(--rm-text-primary)',
          secondary: 'var(--rm-text-secondary)',
          tertiary:  'var(--rm-text-tertiary)',
          disabled:  'var(--rm-text-disabled)',
          'on-accent': 'var(--rm-text-on-accent)',
        },
        border: {
          DEFAULT: 'var(--rm-border-default)',
          strong:  'var(--rm-border-strong)',
          accent:  'var(--rm-border-accent)',
        },
      },
      fontFamily: {
        display: typography.fonts.display.split(','),
        sans:    typography.fonts.sans.split(','),
        mono:    typography.fonts.mono.split(','),
      },
      fontSize: typography.sizes,
      letterSpacing: typography.tracking,
      borderRadius: layout.borderRadius,
      boxShadow: {
        sm: layout.shadows.sm,
        md: layout.shadows.md,
        lg: layout.shadows.lg,
        xl: layout.shadows.xl,
        'glow-sm':     layout.glow.sm,
        'glow-md':     layout.glow.md,
        'glow-lg':     layout.glow.lg,
        'glow-button': layout.glow.button,
      },
      backdropBlur: { xs: '2px', sm: '4px', md: '8px', lg: '12px' },
      animation: {
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245,158,11,0.4)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(245,158,11,0)' },
        },
      },
    },
  },
};
```

### 4.7 Component baselines

**Button**

```tsx
// primary
className="inline-flex items-center justify-center h-11 px-5 rounded-lg
           bg-[var(--rm-accent)] text-fg-on-accent font-medium
           shadow-glow-sm hover:shadow-glow-button hover:brightness-110
           active:scale-[0.98] transition-all duration-200
           focus-visible:outline-none focus-visible:ring-2
           focus-visible:ring-[var(--rm-accent)] focus-visible:ring-offset-2
           focus-visible:ring-offset-bg-page"

// secondary
className="inline-flex items-center justify-center h-11 px-5 rounded-lg
           bg-transparent text-fg border border-border
           hover:bg-white/5 hover:border-border-strong
           active:scale-[0.98] transition-all duration-200
           focus-visible:outline-none focus-visible:ring-2
           focus-visible:ring-[var(--rm-accent)] focus-visible:ring-offset-2
           focus-visible:ring-offset-bg-page"

// ghost
className="inline-flex items-center justify-center h-11 px-4 rounded-lg
           bg-transparent text-fg hover:bg-white/5
           active:scale-[0.98] transition-all duration-200"
```

**Card (glass) — used everywhere `Card` was used**

```tsx
className="bg-bg-glass backdrop-blur-md border border-border rounded-lg
           transition-all duration-300
           hover:border-border-strong"
```

For solid surfaces (e.g. data-dense tables), prefer `bg-bg-elevated` over glass — backdrop-blur on tall content is slow.

**Input**

```tsx
className="h-11 w-full px-3 rounded-lg
           bg-bg-glass backdrop-blur-md border border-border
           text-fg placeholder:text-fg-tertiary
           transition-all duration-200
           focus:outline-none focus:border-[var(--rm-accent)]/50
           focus:ring-2 focus:ring-[var(--rm-accent)]/20
           focus:shadow-glow-sm"
```

**Badge**

```tsx
// neutral
className="inline-flex items-center h-6 px-2 rounded-full
           bg-bg-elevated border border-border text-xs font-mono tracking-wide text-fg-secondary"
// accent (charging active, etc.)
className="inline-flex items-center h-6 px-2 rounded-full
           bg-[var(--rm-accent-muted)] border border-border-accent
           text-xs font-mono tracking-wide text-[var(--rm-accent)] animate-pulse-glow"
```

### 4.8 Layout — sidebar nav (replaces top bar)

```
┌──────────┬─────────────────────────────────────────┐
│          │  StatusBar (live SOC, charger, online)  │
│ Sidebar  ├─────────────────────────────────────────┤
│          │                                          │
│ Riviamigo│  <Outlet>                                │
│  ──      │                                          │
│ ◯ Home   │  PageLayout with title + DateRangePicker │
│ ▱ Battery│                                          │
│ ⤴ Trips  │  StatCardGrid                            │
│ ⚡ Charge │  ChartSection ×N                         │
│ ⚙ Effic. │                                          │
│ ── ── ── │                                          │
│ ⚙ Settings                                          │
│          │                                          │
│ [theme]  │                                          │
│ [user]   │                                          │
└──────────┴─────────────────────────────────────────┘
```

**Sidebar component spec** (`packages/ui/src/primitives/Sidebar.tsx`):

```tsx
interface NavItem {
  to:    string;
  label: string;
  icon:  LucideIcon;
}

interface SidebarProps {
  brand:    React.ReactNode;       // logo + wordmark
  primary:  NavItem[];             // top group
  footer?:  React.ReactNode;       // theme toggle, user menu
  vehicle?: { name: string; soc: number; isOnline: boolean }; // optional pinned status block
}
```

Behavior:
- **Desktop (`lg:` and up):** persistent left rail, 256px wide. Collapsed mode (72px, icons only) toggleable, persisted to localStorage.
- **Tablet/mobile:** drawer overlay opened by hamburger in StatusBar; `bg-bg-overlay` backdrop; close on route change.
- Active route: `bg-[var(--rm-accent-muted)] text-[var(--rm-accent)] border-l-2 border-[var(--rm-accent)]`.
- Inactive: `text-fg-secondary hover:bg-white/5 hover:text-fg`.
- Item label: `text-sm font-medium`. Section heading (if any): `text-xs uppercase tracking-wider text-fg-tertiary`.

**StatusBar component spec** (`packages/ui/src/primitives/StatusBar.tsx`):

```tsx
interface StatusBarProps {
  vehicleName?: string;
  status: VehicleStatus;          // from useVehicleStatus
  onMenuClick?: () => void;        // mobile only
}
```

Renders (left → right): mobile menu, vehicle name, online dot (animated when fresh), SOC pill, charger pill (only if connected, amber pulse if charging), spacer, current location chip (truncated). Height 56px. `bg-bg-glass backdrop-blur-md border-b border-border`.

**`__root.tsx` updated:**

```tsx
function RootLayout() {
  const status = useVehicleStatus();
  return (
    <div className="flex h-screen bg-bg-page text-fg overflow-hidden">
      <Sidebar
        brand={<Brand />}
        primary={[
          { to: '/',           label: 'Overview',   icon: Gauge },
          { to: '/battery',    label: 'Battery',    icon: BatteryCharging },
          { to: '/trips',      label: 'Trips',      icon: Route },
          { to: '/charging',   label: 'Charging',   icon: Zap },
          { to: '/efficiency', label: 'Efficiency', icon: TrendingUp },
        ]}
        footer={<><ThemeToggle /><UserMenu /></>}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={status} />
        <main className="flex-1 overflow-y-auto"><Outlet /></main>
      </div>
      <AmbientOrbs /> {/* fixed-position decorative blobs (dark only) */}
    </div>
  );
}
```

**`AmbientOrbs`:** two `position: fixed` divs with `filter: blur(120px)`, low-opacity amber radial gradients, `pointer-events-none`, `z-index: -1`. **Rendered only when `<html class="dark">`** — gated by `useTheme()`.

### 4.9 Chart visual rules (overrides §9)

- Recharts grid: `stroke="rgba(255,255,255,0.06)"` (dark) / `stroke="rgba(20,20,24,0.06)"` (light), no vertical lines.
- Axis ticks: `font-mono text-[11px] fill-fg-tertiary`.
- Default series color: `dataViz.amber`.
- Area fill: 12% opacity of stroke color.
- Tooltip: glass card with backdrop blur; bordered top with 2px `var(--rm-accent)`; series swatches as small filled rounded squares; values in `font-mono tabular-nums`.
- Animation: 600ms `cubic-bezier(0.16, 1, 0.3, 1)` on mount; no animation on data update.
- `GaugeChart` track: `var(--rm-border-default)`. Active arc: `colorFn(value)` from `colors.soc`. Center number: `font-display text-5xl font-bold tabular-nums`.

### 4.10 Storybook coverage update

Each chart story file gets a `Light` variant added to the original §13 list. Mechanism: top-level toolbar globalType (`theme`) toggles `<html class="dark">`/`<html class="light">` (already wired in §3.12).

---

## 5. Refined Build Order (v0)

Replaces the original §16. Each phase ends with a **self-verification command** Sonnet must run successfully before continuing.

### Phase 1 — Repo skeleton & infra

1. `pnpm init`, write `pnpm-workspace.yaml`, `turbo.json`, root `package.json` (paste from original §20, replace names with `riviamigo`).
2. Create directories per original §3 **minus** `apps/mobile/` and `infra/grafana/`.
3. `infra/docker-compose.yml` with TimescaleDB, Redis, MinIO (paste from original §14, fix names).
4. `apps/api/Cargo.toml` (paste from original §17, rename binary to `riviamigo-api`).
5. Migrations 0001–0006 written. Apply against fresh container.
6. **Verify:** `docker compose up -d && cd apps/api && sqlx migrate run && psql -c '\dt riviamigo.*' -c '\dt timeseries.*'` lists all expected tables.

### Phase 2 — Token system & primitives

1. Write all of `packages/ui/src/tokens/` per §4.2–§4.5 above.
2. Write `globals.css` per §4.3.
3. Write `packages/config/tailwind/base.ts` per §4.6.
4. Write `apps/web/tailwind.config.ts`, `apps/web/index.css` (imports `globals.css`).
5. Set up `packages/ui/.storybook/{main.ts,preview.ts}` per §3.12.
6. Implement primitives in this order: `Skeleton`, `Button`, `Badge`, `Card`, `Input`, `StatCard`, `PageLayout`+`ChartSection`+`StatCardGrid`, `Sidebar`, `StatusBar`, `ThemeToggle`, `AmbientOrbs`. Each with a `.stories.tsx` covering Default + (where applicable) Loading, Empty, Error, plus toolbar theme toggle exercising both `dark` and `light`.
7. **Verify:** `pnpm --filter @riviamigo/ui storybook` builds; visual check that dark and light render correctly via toolbar toggle.

### Phase 3 — Chart components

1. `ChartProvider`, `useChartTheme`, `ChartTooltip`, `ChartSkeleton`.
2. Implement charts in order: `AreaChart`, `BarChart`, `GaugeChart`, `DonutChart`, `ScatterChart`, `ChargeCurveChart`, `TripMapChart`. Each with stories for Default / Loading / Empty / Error / Compact / Tall / DarkMode / LightMode.
3. **Verify:** `pnpm --filter @riviamigo/ui build-storybook` succeeds; spot-check stories render in both themes.

### Phase 4 — Backend foundation

1. `errors.rs` (paste original §7), `config.rs`, `db/pool.rs`.
2. `routes/mod.rs`, `health` route. Boot the app, hit `/health`.
3. **Verify:** `cargo clippy -- -D warnings && cargo test` passes; `curl localhost:3001/health` returns `ok`.

### Phase 5 — Auth

1. `models/user.rs`, `db/users.rs`, `db/refresh_tokens.rs` per §2.1–§2.2.
2. `routes/auth.rs`: register, login, refresh, logout, me.
3. `middleware/auth.rs`: `AuthUser` extractor.
4. `db/vehicles.rs::require_vehicle_owned`.
5. Rate-limiting middleware per §3.14.
6. Integration test: register → login → refresh → access `/auth/me` → logout → refresh fails.
7. **Verify:** `cargo test auth` passes; manually verify `curl` flow.

### Phase 6 — Ingestion pipeline

1. `models/telemetry.rs`, `models/trip.rs`, `models/charge_session.rs` (paste from original §18, fix names).
2. `ingestion/parser.rs` (paste from original §18) **plus** proptest fuzz harness using `proptest::prelude::*` generating arbitrary JSON shapes; assert no panics over 10,000 cases.
3. `ingestion/trip_detector.rs` (paste from original §18, plus tests).
4. `ingestion/charge_detector.rs` per §2.6.
5. `ingestion/session_store.rs` (age encrypt/decrypt of token bundle).
6. `ingestion/rivian_auth.rs` per §2.3 contract; HTTP calls via `reqwest`.
7. `ingestion/ws_client.rs` with subscription document from §3.17; reconnect with backoff; emits parsed events to a channel.
8. `ingestion/poller.rs` per original §4.2 state machine.
9. `ingestion/worker.rs` orchestrates auth → WS + poll → detect trips/charges → write DB → publish Redis snapshot.
10. `ingestion/supervisor.rs` per §2.5; spawn-on-startup logic in `main.rs` per §3.16.
11. **Verify:** `cargo test ingestion -- --include-ignored` passes (the fuzz tests are slow). Manually run the worker against a stubbed Rivian server (test fixture) and confirm rows land in TimescaleDB.

### Phase 7 — Data API routes

In this order (each with integration test that asserts cross-user isolation):
1. `routes/vehicles.rs`: `POST /vehicles/connect`, `/vehicles/connect/otp`, `POST /vehicles`, `GET /vehicles`, `GET /vehicles/:id/status` (reads `vehicle_runtime_state`).
2. `routes/battery.rs` per original §18.
3. `routes/trips.rs` (list, detail, track per §3.7, speed, elevation).
4. `routes/charging.rs` per §3.4.
5. `routes/efficiency.rs` per §3.5.
6. `routes/stats.rs` per §3.3.
7. `routes/grafana.rs` — stub `501` for `/grafana/query` and `/grafana/search`.
8. **Verify:** `cargo test routes` passes including a deliberate "user A can't read user B's vehicle" test for every endpoint.

### Phase 8 — Live status WS

1. `routes/live.rs` — WS upgrade handler per §2.4.
2. Worker side: snapshot publisher to `vehicle:{id}:status`.
3. **Verify:** integration test connects to WS, sends a fake telemetry event into the worker channel, asserts the WS client receives the matching snapshot.

### Phase 9 — Web app shell

1. Vite + React init at `apps/web` per original §19.
2. TanStack Router with file-based routes; generate `routeTree.gen.ts` from skeleton.
3. `RootLayout` with Sidebar + StatusBar + AmbientOrbs per §4.8.
4. Theme persistence + FOUC-prevention inline script in `index.html`.
5. Auth wiring: login + register pages, Zustand auth store holding access token in memory, refresh on 401, redirect to `/login` if both fail.
6. `<RequireVehicle>` gate that redirects to `/connect` if `default_vehicle_id` is null.
7. `useDefaultVehicleId`, `useVehicleStatus` (WS connection lifecycle), `useApi` (fetch with auth header + auto-refresh).
8. **Verify:** Playwright E2E: register → login → reach onboarding → mocked vehicle add → land on `/`, sidebar visible, status bar shows "Offline".

### Phase 10 — Pages

In order, each ships with stories for the composed page if useful and integration with real API:
1. **Connect / onboarding** (`/connect` and `/connect/otp`): single-vehicle wizard.
2. **Home** (`/`): live status hero (Gauge + StatCards) + lifetime stat tiles.
3. **Battery** (`/battery`): SOC AreaChart, range AreaChart, capacity AreaChart, phantom drain BarChart, current SOC GaugeChart.
4. **Trips** (`/trips` list + `/trips/:id` detail): DataTable (TanStack Table), TripMapChart, speed AreaChart, elevation AreaChart, stat cards.
5. **Charging** (`/charging` list + `/charging/:id` detail): DataTable, ChargeCurveChart, DonutCharts (home/away, type), weekly BarChart.
6. **Efficiency** (`/efficiency`): trend AreaChart, by-mode BarChart, range-vs-temp ScatterChart with trend line.
7. **Settings** (`/settings`): electricity rate, units, theme, "disconnect vehicle" — that's it for v0.
8. **Verify:** Playwright suite covers the golden path on each page.

### Phase 11 — Hardening

1. Security headers per §3.15. CSP tightened to actual prod hosts.
2. Cross-user leak audit: a single Playwright test that logs in as user A, attempts every `/v1/*` endpoint with user B's `vehicle_id`, asserts 403.
3. CI: GitHub Actions per original §14 with `cargo audit`, full Playwright suite, Storybook build artifact.
4. **Verify:** full CI passes on a PR; no `clippy` warnings; no console errors in any E2E run.

---

## 6. Deferred Phase Markers

These are kept in sight so v0 doesn't accidentally paint itself into a corner:

### v0.5 — power-user features

- **Multi-vehicle UI:** add vehicle picker in StatusBar, persist selection in `users.default_vehicle_id` via `PATCH /auth/me`. No backend changes needed — endpoints already take `vehicle_id`.
- **Data export:**
  - `GET /v1/trips/:id/track.gpx?vehicle_id` — text/xml; reuses §3.7 query.
  - `GET /v1/trips.csv?vehicle_id&from&to` — text/csv; trips list flat.
  - `GET /v1/charging.csv?vehicle_id&from&to` — sessions list flat.
  - Settings page adds "Export" group.
- **Grafana SimpleJSON:**
  - Implement `routes/grafana.rs` properly; add `/grafana/datasource` health check, `/grafana/query` (POST), `/grafana/search`.
  - API key middleware reads `X-Riviamigo-API-Key` header, validates against `riviamigo.api_keys` table (new migration); enforces read-only and per-vehicle scoping.
  - `infra/grafana/provisioning/datasources/riviamigo.yaml` — pre-provisioned datasource pointing at the API.

### v1 — mobile

- `apps/mobile` Expo app, file-based routing, shares `packages/hooks` and `packages/types`.
- `useVehicleStatus`, `useBattery`, etc. need to abstract storage (web: localStorage; native: AsyncStorage) — defer this abstraction until v1, do NOT prematurely generalize in v0.
- Push notifications via Expo Push for charge complete, low SOC, phantom drain alerts.

### v1+

- Trip cost analytics (gas-equivalent comparisons).
- Weather enrichment of `trips.outside_temp_c` via OpenWeather one-call API at trip close.
- Charger network favorites with rating notes.
- Route planning with SOC projection.

---

## 7. Open Questions to Resolve Before Implementation

These are explicitly UNANSWERED by both the original spec and this addendum. Sonnet should NOT guess — surface them in the first PR's description so a human can decide:

1. **Production deployment target.** k8s? Fly.io? bare Docker compose? Affects MinIO endpoint, TLS termination, CORS origin list.
2. **Email delivery for password reset.** Out of scope for v0 (no reset flow in this addendum). Acceptable?
3. **Self-hosted map tiles.** Original spec mentions Protomaps "or" carto CDN. v0 uses public carto CDN (zero infra), but this puts user trip GPS through a third party. If unacceptable, defer trip map to v0.5.
4. **Rivian ToS.** This project hits an unofficial API. Acceptable risk profile? Rate limits per §4.2 of original spec are non-negotiable regardless.

---

## 8. Quick-reference checklist for Sonnet

Before opening a PR for any phase, verify:

- [ ] Every name says `riviamigo` / `Riviamigo`; no `rivianmate` left.
- [ ] No hardcoded hex strings outside `packages/ui/src/tokens/`. `grep -r '#[0-9A-Fa-f]\{6\}' apps packages | grep -v tokens` returns nothing.
- [ ] Every `/v1/*` endpoint takes `vehicle_id` query param and calls `require_vehicle_owned`.
- [ ] No data flows from a column not in a migration; no SQL string interpolation; sqlx compile-time checks pass.
- [ ] Every new chart has a story with `Default`, `Loading`, `Empty`, `DarkMode`, `LightMode`.
- [ ] No `console.log`, no `dbg!()`, no `unwrap()` outside tests/main bootstrap.
- [ ] `cargo clippy -- -D warnings` clean. `pnpm typecheck` clean. `pnpm lint` clean.
- [ ] At least one Playwright test exercises the new feature end-to-end.

---

*End of v0 addendum. v0.5 / v1 phases will get their own addenda.*
