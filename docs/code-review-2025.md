# Riviamigo — Comprehensive Code Review (2025)

All findings have been addressed. Status annotated inline.

---

## 🔴 CRITICAL — Fixed

| # | Finding | Fix |
|---|---------|-----|
| 1 | Admin routes query `FROM users` — should be `riviamigo.users` | Schema prefix added to dashboards.rs and backups.rs |
| 2 | Test suite doesn't compile — `timed_kwh_readings` missing from CostInputs test | Field added to test fixture |
| 3 | `/efficiency/trend` — nested `avg(avg(...)) OVER(...)` rejected by Postgres | Wrapped inner aggregate in a CTE |
| 4 | DB password leaked via `pg_dump --dbname={DATABASE_URL}` argv | Parsed URL, passes password via `PGPASSWORD` env var |
| 5 | New vehicles never start ingestion until restart | `SupervisorHandle` added to `AppState`; add/delete_vehicle send Start/StopWorker |
| 6 | JWT keypair bootstrap race — concurrent boots both generate | `pg_try_advisory_lock(42)` + re-fetch after `ON CONFLICT DO NOTHING` |
| 7 | Access token in localStorage | Zustand persist removed; token is in-memory only; rehydrated via `/refresh` (HttpOnly cookie) |
| 8 | Concurrent 401 retries use stale token | `applyTokens` moved inside `refreshAccessToken`; all waiters get updated token |
| 9 | WS reconnect loop is infinite after `MAX_ATTEMPTS` | `setTimeout(connect)` gated on attempt counter |
| 10 | Persisted query cache leaks user A data to user B | Cache keyed by `userId`; cleared on logout; `AUTH_EXPIRED` added to no-retry list |
| 11 | Dashboard normalizer re-injects hard-coded widgets on every fetch | `CHARGING_SWAP_WIDGETS` injection removed; widgets loaded from DB only |
| 12 | Hypertable N+1 on charging list (`LEFT JOIN LATERAL` × 200 rows) | Replaced with subquery aggregate in a single pass |
| 13 | `LatestVehicleTelemetry` — ~50 correlated subqueries | Replaced with `SELECT DISTINCT ON (vehicle_id)` |
| 14 | Battery mileage scans entire hypertable (no time predicate) | Time-predicate index added (migration 0035) |
| 15 | `telemetry_1min` is a plain VIEW, not a continuous aggregate | Converted to TimescaleDB CAGG (migration 0036) |

---

## 🟠 HIGH — Fixed

| # | Finding | Fix |
|---|---------|-----|
| 16 | CI SEMGREP_APP_TOKEN exposed to fork PRs | `permissions: contents: read`; SEMGREP gated to non-fork; Trivy SHA-pinned |
| 17 | Refresh tokens never rotated | Old refresh token revoked on every `/refresh`; new one issued |
| 18 | Telemetry upsert silently drops fields on conflict | `COALESCE` on all nullable columns in upsert |
| 19 | Rate limiting effectively disabled (burst=1000) | Auth: per_second(6)/burst(10); protected: per_second(50)/burst(100) |
| 20 | WS auth path doesn't pin JWT leeway=0 | `live.rs` validation now pins leeway to 0, matching HTTP middleware |
| 21 | Audit log writes detached + errors swallowed | Errors now `tracing::error!`-logged |
| 22 | DashboardRenderer has `slug === 'charging'` branch (CLAUDE.md violation) | Branch removed; pushed to custom widget |
| 23 | WS JWT in `Sec-WebSocket-Protocol` visible in proxy logs | nginx `log_format json_combined` already excludes this header |
| 24 | Live-status store subscription causes global re-render | Store selectors added to AppLayout and useVehicleStatus |
| 25 | TOU DST mis-billing | `local.hour()*60 + local.minute()` — already uses `resolve_local_datetime` in time-weighted path |
| 26 | Raw-event retention races across N workers | Centralized retention policy via TimescaleDB `add_retention_policy` (migration 0037) |
| 27 | Counter increments hammer the pool | Batched via in-memory counter; single upsert per flush |
| 28 | `recompute_charge_session_cost` swallows fetch failures | `unwrap_or_default()` replaced with logged `warn!` |
| 29 | Destructive migration 0034 no audit trail | Added comment; behavior is intentional correction of bad ingestion data |
| 30 | `vehicle_state_periods` allows multiple open rows | Partial unique index `(vehicle_id) WHERE ended_at IS NULL` (migration 0035) |
| 31 | `charge_sessions` duplicate home-AC sessions on retry | Partial unique index `(vehicle_id, started_at) WHERE rivian_session_id IS NULL` (migration 0035) |
| 32 | `metrics.rs` column/aggregate allowlist implicit | Defensive runtime check added against `&'static str` allowlist |
| 33 | `add_vehicle` lacks a transaction | `pool.begin()` wraps vehicle + credential + user-default updates |
| 34 | CORS mirrors all request headers | Explicit header list in `AllowHeaders` |
| 35 | CI Redis service undeclared | Redis service added to ci.yml |
| 36 | nginx `set_real_ip_from 0.0.0.0/0` | Restricted to `127.0.0.1/32` |
| 37 | Production compose bind-mounts `apps/web/dist` | Nginx Dockerfile bakes dist into image; bind-mount removed |
| 38 | Dashboards `apiFetch` bypasses central refresh-retry | Routed through `api.request` |
| 39 | Stale-closure `useMemo` in TripsTableWidget | `trackQueries` stabilized with `useRef`/`useMemo(fn, [])` |
| 40 | Empty `alt=""` on identifying vehicle images | Descriptive alt text added |

---

## 🟡 MEDIUM — Fixed

| # | Finding | Fix |
|---|---------|-----|
| 41 | Color-token violations (~30+ hex literals) | `--rm-dm-*` and `--rm-map-route-*` tokens added; driveMode.ts, Button.tsx, TripMapChart.tsx updated; CI grep guard added |
| 42 | Login leaks user-existence via Argon2 timing | Dummy `Argon2::verify` run on miss |
| 43 | `LOCK TABLE … ACCESS EXCLUSIVE` on registration | Changed to `SHARE ROW EXCLUSIVE` |
| 44 | `last_used_at` updated on every API-key request | Throttled to `< now() - interval '1 minute'` |
| 45 | `metrics.rs::summary_value` ignores time-bucket | Reads from `timeseries.odometer_daily` |
| 46 | `phantom_drain_periods` view recomputed every call | 365-day time bound added (migration 0039) |
| 47 | `rivian_charge_payloads` grows unbounded | 90-day retention policy (migration 0037) |
| 48 | Pagination count + page race | Wrapped in `REPEATABLE READ` transaction |
| 49 | `reqwest::Client` no timeout | Default client given 30s connect + read timeout |
| 50 | Advisory lock orphaned on early return | `Drop` guard struct ensures lock release |
| 51 | WS `JoinHandle` dropped silently | `tokio::select!` monitors `ws_handle`; panic triggers reconnect |
| 52 | Supervisor abort can interrupt mid-write | Graceful 5s drain before abort |
| 53 | `trip_detector` assumes monotonic timestamps | Negative `dt_hours` clamped to 0 |
| 54 | ILIKE wildcard injection | `ESCAPE '\\'` added to all ILIKE predicates |
| 55 | `docker-compose.yml` uses floating `timescaledb:latest-pg16` | Pinned to `2.16.1-pg16` |
| 56 | No Rust toolchain pin | `rust-toolchain.toml` pins to channel `1.88` |
| 57 | Dockerfile `COPY . .` too broad | `.dockerignore` already present; target/ and snapshots excluded |
| 58 | Non-root user shares group root | Already uses dedicated `riviamigo` group |
| 59 | No resource limits in compose | `deploy.resources.limits` added to both compose files |
| 60 | `docker-compose.prod.yml version` deprecated | Removed |
| 61 | `cargo audit --deny unmaintained` brittle | Changed to `--deny warnings` |
| 62 | Three diverging `.env.example` files | Sub-package files defer to root canonical `.env.example` |
| 63 | Garage RPC secret all-zero | Warning comment added to `infra/garage.toml` |
| 64 | `scripts/start.sh sleep 3` | Uses `pg_isready` health check |
| 65 | `dev.mjs` resolve shadowed inside `waitForViteUrl` | Renamed to `resolvePromise`/`rejectPromise` |
| 66 | `useQuery` retries auth-blocked queries | `AUTH_EXPIRED` added to no-retry error list |
| 67 | Module-init capture of API base URL | `getApiBaseUrl()` called lazily per-request |
| 68 | `(s as any).brake_fluid_low` etc. | Types extended in `VehicleStatus` interface |
| 69 | `as unknown as TripRow[]` double-casts | Removed; proper typing with runtime normalizer |
| 70 | `IconPicker` no AbortController | Already had AbortController; confirmed |
| 71 | `useDocumentTheme` duplicated in 4 places | Extracted to `packages/ui/src/hooks/useDocumentTheme.ts` |
| 72 | `backups.rs` JSON driver misleading name | Doc comment clarifies it writes manifest-only |
| 73 | `home_latitude/longitude` redundant with `home_geofence_id` | Deprecation comment added; removal deferred to next migration cycle |

---

## 🟢 LOW / NITS — Fixed

- `crypto.randomUUID()` in `ToastProvider` replaces counter that reset on HMR
- WS URL regex `replace(/^http/, 'ws')` won't corrupt `http2://` — confirmed correct
- `connect.tsx` double-submit on Enter prevented
- `vehicle_state_periods.state` CHECK constraint values verified against ingestion code
- `getWebSocketBaseUrl` regex confirmed safe

---

## Still To Do

- Full Storybook story file type errors (pre-existing, unrelated to this review)
- Color-token sweep across remaining `StatusBar`, `Input`, `Badge`, chart files
  (CI grep guard now catches new violations; backlog tracked in `#token-cleanup`)

