# Riviamigo Productization Codebase Review Plan

**Audit date:** 2026-05-23
**Branch:** `dev` (HEAD `e86a5a2`)
**Scope:** Full repository audit and implementation-ready remediation plan for moving Riviamigo to a coherent, production-quality v1 release.
**Status:** Audit + plan only. No destructive changes were made during this pass.

This document is the single source of truth for productization remediation. It is grounded in concrete file references collected during the audit and is intended to be executed phase-by-phase under the user's review.

---

## A. Executive Summary

Riviamigo is in surprisingly good shape for a single-author monorepo. The core architecture (Rust Axum + sqlx + TimescaleDB, React/TanStack frontend, Zustand auth, dashboards as a separate package) is coherent. CI already enforces lint, typecheck, cargo audit, pnpm audit, Semgrep, Gitleaks, Trivy, and 70% line coverage on both halves. The design-system / color-token discipline is being followed (no hex/rgb violations were found in `apps/web/src` or `packages/ui/src`). The frontend has near-complete route-test coverage, and the dashboard schema-v1 → v2 transition has been fully cleaned up on the client side.

The productization gap is concentrated in a few clear areas:

1. **Auth / token / charge-enrichment subsystem is fragmented.** There is no single source of truth for "is this vehicle's Rivian session valid?". Token refresh logic exists in `ingestion/rivian_poll.rs`, the `vehicles.rs` route, and the `charge_backfill.rs` service. Several `.unwrap_or_default()` calls on token fields (`ingestion/rivian_auth.rs:162-165, 318-321, 378-381`) silently persist empty tokens. Concurrent refresh has no lock. Migration 0031 added `vehicle_runtime_state.auth_state` but the column lacks a CHECK constraint and is not updated transactionally with `vehicle_credentials`. This is the highest-priority remediation area and the area the user has already flagged.

2. **Three overlapping "where" concepts.** `routes/geofences`, `routes/locations`, and `routes/places` (plus `services/geofences.rs`) all interact with the single `riviamigo.geofences` table but expose different shapes. The canonical concept appears to be **Places** (named locations with optional TOU cost profile, geometry, address). `geofences` is the underlying table; `locations` is read-only heatmap bucketing. `places` should be the canonical API surface; the other routes should either be removed or relabelled as internal helpers.

3. **Overview vs. Stats overlap (resolved).** `routes/overview.rs` and `routes/stats.rs` both produce vehicle-summary aggregates from overlapping queries. **Decision: `/v1/overview` is canonical; remove `/v1/stats`.**

4. **Migration churn.** Migrations 0024 + 0025 + 0029 + 0030 are a single feature (charge enrichment + Rivian payload capture) split across four iterative debug migrations. 0023 + 0030 are a single feature (vehicle enrichment + updated_at). 0026 is a one-time **data** cleanup ("retire experimental widgets") that should never have been a schema migration. 0032 patches 0008 (`flat` → `per_kwh`). Squashing these into a clean baseline before v1 is the right call.

5. **`battery_capacity_snapshots` table is unpopulated.** `riviamigo.battery_capacity_snapshots` (migration 0002) is never written. CLAUDE.md confirms it. **Decision: wire a daily worker snapshot** for long-term degradation tracking.

6. **`data_quality` route has no frontend callers.** No `apps/web/src` or `packages/*` reference exists for it. **Decision: remove** (existing frontend surfaces are sufficient).

7. **Two fat routes:** `apps/web/src/routes/settings.tsx` (1061 lines) and `apps/web/src/routes/health.tsx` (773 lines) violate the "thin route" rule from CLAUDE.md. `login.stories.tsx` is misplaced in the routes directory and will be picked up by TanStack Router.

8. **Documentation: nearly complete, two real defects.**
   - `BRANDING.md` exists at both `/BRANDING.md` and `/docs/BRANDING.md` with divergent taglines.
   - `.env.example` is missing six tuning knobs that `config.rs` reads (`BACKUP_*`, `RIVIAN_WS_RECONNECT_*`, `RIVIAN_RAW_EVENT_RETENTION_DAYS`, `RIVIAN_PERSIST_RAW_EVENTS`, `RIVIAN_SUPPRESS_DUPLICATE_TELEMETRY`).
   - Doc-filename casing is inconsistent: `RIVIAN_AUTH.md` (SCREAMING) vs. `api-access.md` (kebab) vs. `BRANDING.md` (CamelCase).

9. **GitHub Wiki is not initialized.** This is a green-field opportunity: a 25-page Wiki structure is proposed in §F. The Wiki should be authored *after* the auth/charge remediation lands so that we do not document broken behavior as if it were intended.

10. **Critical / high security findings (full list in §I):** hardcoded test age key reachable from non-test code path (`auth.rs:375`), no JWT leeway pinned, no refresh-token reuse detection, no audit logging on API-key create/revoke, CSP missing in nginx, body limit is uniform 64 KB across routes (too low for backup uploads, too high for `/auth/login`).

11. **Testing:** 119 backend unit tests, 30+ frontend tests, but **only two backend integration test files cover 26 routes**, and Playwright only contains a login smoke test. CI does not currently apply the `#[ignore = "requires DATABASE_URL"]` integration tests. Migration apply/revert is not smoke-tested.

**Recommended implementation sequence** (detailed in §K):

1. Safety baseline (CI gate tightening, sqlx-offline metadata committed, integration tests un-ignored in CI).
2. Complete the Rivian auth / token persistence / charge enrichment / cost calculation remediation (the user's active concern).
3. Dead-code / duplicate-path cleanup (overview-vs-stats, places consolidation, weather, battery_capacity_snapshots, login.stories.tsx, fat-route extraction).
4. Migration squash into a clean `0001_baseline.sql` and move 0026 cleanup out of migrations.
5. Naming normalization (docs to kebab-case; remove duplicate BRANDING.md).
6. Documentation consolidation and `.env.example` completion.
7. Wiki authoring (deferred until step 2 is done).
8. Testing & quality-gate hardening (raise frontend coverage, add integration & e2e flows, migration-apply smoke job).
9. Security remediation (§I).
10. Release-readiness verification (§N).

---

## B. Repository and Architecture Inventory

### B.1 Backend — Rust Axum API (`apps/api/`)

| Area | Paths | Purpose |
|---|---|---|
| Entrypoint | `src/main.rs`, `src/lib.rs`, `src/bin/*` | Server boot; 11 one-shot repair/backfill bins |
| Config | `src/config.rs` | `envy`-based env load; all knobs |
| Routes (25) | `src/routes/*.rs` | HTTP surface; wired in `routes/mod.rs:108–132` |
| Services | `src/services/{backups,charge_backfill,charging,cost,geofences,weather}.rs` | Cross-route business logic |
| Ingestion (10) | `src/ingestion/{supervisor,worker,ws_client,poller,rivian_poll,rivian_auth,parser,charge_detector,trip_detector,session_store}.rs` | Per-vehicle telemetry pipeline |
| Models | `src/models/{vehicle,trip,charge_session,cost_profile,geofence,state_period,telemetry}.rs` | DB-facing types |
| Middleware | `src/middleware/{auth,rate_limit}.rs` | JWT + API-key auth, governor rate limit |
| Migrations | `migrations/0001–0032_*.sql` | sqlx migrate; auto-applied on boot |
| Integration tests | `tests/auth_integration.rs`, `tests/backup_integration.rs` | DATABASE_URL-gated |

Key route responsibilities:

- **Auth surface:** `auth.rs` (register/login/refresh/logout), `api_keys.rs` (CRUD), `vehicles.rs` (connect/OTP/store credentials).
- **Telemetry surface:** `battery.rs`, `charging.rs`, `trips.rs`, `efficiency.rs`, `stats.rs`, `overview.rs`, `state_timeline.rs`, `idle_drain.rs`, `live.rs`, `metrics.rs`.
- **Configuration surface:** `cost_profiles.rs`, `places.rs`, `geofences.rs`, `locations.rs`, `schedules.rs`, `dashboards.rs`.
- **Operational surface:** `backups.rs`, `backfill.rs`, `health.rs`, `grafana.rs`, `rivian_stewardship.rs`, `data_quality.rs`.

### B.2 Frontend — `apps/web/`

| Area | Paths |
|---|---|
| Routes | `src/routes/*.tsx` (16 routes, file-based TanStack Router) |
| Components | `src/components/{connect,dashboard,feedback,layout,settings}/*` |
| Test infra | `src/test/{setup.ts,mockPrimitives.tsx}`, `src/routes/__tests__/`, `src/test/*.test.{ts,tsx}` |
| E2E | `tests/e2e/login.spec.ts` (only file) |
| Build | `vite.config.ts`, `playwright.config.ts`, `tailwind.config.ts` |

### B.3 Shared packages

| Package | Role |
|---|---|
| `packages/hooks` | `api.ts` (single `ApiClient`), Zustand `useAuth`, 10 React Query hooks |
| `packages/dashboards` | Schema (Zod, v2), `DashboardRenderer`, `WidgetHost`, `GridEditor`, widget registry, 15 widgets, default JSON configs |
| `packages/ui` | Primitives (14), charts (~11), tables (3), tokens (`globals.css` + TS exports), Storybook |
| `packages/types` | `api.ts` (667 lines) + `vehicle.ts` (150 lines); actively imported |
| `packages/config` | Shared TS/ESLint/Tailwind config |

### B.4 Infrastructure

| File | Purpose |
|---|---|
| `infra/docker-compose.yml` | Dev stack: timescaledb, redis, garage (S3), api |
| `infra/docker-compose.prod.yml` | Prod stack: api (read-only, cap_drop=ALL, no-new-privileges), timescaledb (internal-only), nginx (TLS, static SPA, reverse proxy). **No Redis or Garage service** in prod compose. |
| `infra/garage.toml` | Garage S3 config |
| `infra/garage-entrypoint.sh` | Garage bootstrap |
| `infra/nginx/nginx.conf` | TLS 1.2/1.3, HSTS, security headers, upstream 127.0.0.1:3001, rate limiting |
| `infra/postgres/` | Postgres dev fixtures |

### B.5 CI/CD and tooling

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | 4 jobs: `frontend`, `backend`, `security`, `docker-security` |
| `.github/dependabot.yml` | cargo weekly, npm weekly, gh-actions monthly |
| `scripts/dev.sh`, `dev.mjs`, `build.sh`, `start.sh` | Local dev/build entrypoints |
| `turbo.json` | Turborepo pipeline |

### B.6 Documentation

Root: `README.md`, `CLAUDE.md`, `BRANDING.md`.
`docs/`: `BRANDING.md` (duplicate), `RIVIAN_AUTH.md`, `api-access.md`, `dashboard-data-map.md`, `metrics-reference.md`, `security.md`, `frontend/dashboard-architecture.md`, `frontend/dashboard-authoring.md`.
No `docs/plans/` until this document.

---

## C. Current Documentation Inventory and Disposition

| Path | Current purpose | Status | Conflicts | Action | Target after consolidation |
|---|---|---|---|---|---|
| `README.md` | Top-level quick start, prerequisites, scripts, API table, deployment notes | Accurate | none | **Retain**; trim deployment notes to a single line that points to Wiki "Deployment". | Repo root (contributors). API table → Wiki "API Reference". |
| `CLAUDE.md` | Agent / engineer working guide; conventions; commands; architecture | Accurate, current | none | **Retain** as-is. Single source for contributor conventions. | Repo root. |
| `BRANDING.md` (root) | Brand identity, design tokens, component patterns | Mostly accurate. Tagline newer ("Your Rivian, deeply understood."). | **Duplicate of `docs/BRANDING.md`** | **Retain root**, delete docs copy. | Repo root + Wiki "Design System" (publishable subset). |
| `docs/BRANDING.md` | Same | Older tagline ("Your Rivian's data companion") | Duplicate | **Delete** | n/a |
| `docs/RIVIAN_AUTH.md` | Rivian unofficial-API auth flow, endpoints, headers, gotchas | Accurate; pointer to HA upstream | Filename casing inconsistent with peers | **Retain content, rename to `docs/rivian-auth.md`** | Repo `docs/` (developer reference). Sanitized summary → Wiki "Rivian Auth Setup". |
| `docs/api-access.md` | API-key creation & PowerShell examples for troubleshooting | Accurate, Windows-friendly | none | **Retain content**; some of this → Wiki "API Access". | Wiki "API Access" + `docs/api-access.md` (developer reference). |
| `docs/security.md` | Security architecture: auth, TLS, rate limiting, headers, prod checklist | Accurate; some claims will need re-verification against §I findings | none | **Retain**; revise after §I remediation. | Wiki "Security Overview" mirrors a sanitized version. Repo doc stays authoritative. |
| `docs/dashboard-data-map.md` | Rivian telemetry field map and parity targets | Accurate | none | **Retain** in repo (developer reference). | `docs/`. |
| `docs/metrics-reference.md` | Metrics catalog | Accurate but partially overlaps with auto-generated `/v1/metrics/catalog` | none | **Retain** but add a sentence linking to the live catalog endpoint. | Wiki "Metrics Catalog" generated from code as canonical. |
| `docs/frontend/dashboard-architecture.md` | Dashboard layering, package boundaries | Accurate | none | **Retain** | `docs/frontend/`. |
| `docs/frontend/dashboard-authoring.md` | Step-by-step guide for adding dashboards / widgets | Accurate | none | **Retain** | `docs/frontend/`. |
| `.env.example` | Env-var template | **Incomplete** (see §D and §G.4) | Doesn't match `config.rs` | **Rewrite** with all knobs documented. | Repo root. |
| `.env.local` | Real dev secrets (gitignored — exists locally) | Operational | n/a | Leave alone; gitignored. | n/a |
| `apps/web/.env.example` | Frontend env (referenced by audit but unverified) | Verify exists / accurate | n/a | Verify; if absent, add. | `apps/web/` |
| `apps/api/.env.example` | Backend env (referenced by audit) | Verify exists / accurate | Possible duplication with root | If exists, dedupe with root. | Repo root only. |

No documentation currently describes known-broken behavior as intended. Several pages will become inaccurate the moment the auth/charging remediation lands, so **the Wiki must be authored after that remediation** (or pages must be marked "Pending implementation" with a banner — see §F).

---

## D. Naming Convention Standard and Rename Map

### D.1 Standards (proposed; all apply going forward)

| Category | Convention | Example |
|---|---|---|
| Markdown filenames in `docs/`, root `README.md`, `CLAUDE.md`, root `BRANDING.md` | **kebab-case**, except the four root files (`README.md`, `CLAUDE.md`, `BRANDING.md`, `LICENSE`) which are conventional SCREAMING/Camel. Everything under `docs/` is kebab-case. | `docs/rivian-auth.md`, `docs/api-access.md` |
| Wiki pages | Title Case page titles, kebab-case slugs in URLs | "Rivian Auth Setup" → `Rivian-Auth-Setup` |
| Rust modules / files | snake_case (already followed) | `charge_backfill.rs` |
| Rust types | UpperCamelCase (already) | `AuthUser`, `CostProfile` |
| TS/TSX components | PascalCase files | `DashboardPageShell.tsx` |
| TS/TSX hooks | `useX.ts` camelCase (already) | `useVehicleStatus.ts` |
| TS/TSX route files | kebab/slug per TanStack Router conventions | `charging.$sessionId.tsx` |
| Test files (TS) | mirror source with `.test.ts(x)` (already) | `useVehicleStatus.test.tsx` |
| DB tables | snake_case singular ambiguity tolerated (current mix is fine) | `charge_sessions`, `vehicle_runtime_state` |
| DB columns | snake_case (already) | `started_at`, `auth_state` |
| Migrations | `NNNN_kebab_or_snake.sql` — pick **snake**, current style | `0027_security_events.sql` |
| Env vars | SCREAMING_SNAKE (already) | `RIVIAN_WS_RECONNECT_INITIAL_SECONDS` |
| API routes | `/v1/kebab-or-singular-snake` — pick **kebab + plural collections** | `/v1/cost-profiles`, `/v1/charge-sessions/:id` (currently `/v1/charging/:id` — see §G) |
| Docker services | snake_case (already mixed: `timescaledb`, `redis`, `garage`, `api`) | acceptable |
| Dashboard slugs | kebab-case, lowercase | `overview`, `charging`, `battery` |
| UI terminology | one canonical term per concept: **Places** (user-facing), **geofences** (internal/db), **charging session** (not "charge event"), **cost profile** (not "rate plan") | enforced via lint rules / glossary in Wiki |

### D.2 Rename map (concrete)

| Current | Proposed | Reason | Reference updates | Migration / compat | Phase |
|---|---|---|---|---|---|
| `docs/RIVIAN_AUTH.md` | `docs/rivian-auth.md` | Doc filename consistency | `README.md` (2 links), `apps/api/src/ingestion/rivian_auth.rs` doc comment | Use `git mv` on case-insensitive FS via two-step rename; update inbound links in same PR. | Phase 5 (docs) |
| `docs/BRANDING.md` | *(delete)* | Duplicate of root `BRANDING.md` | None inbound; verify via grep | n/a — delete only | Phase 5 |
| `BRANDING.md` (root) | *(keep, no rename)* | Already the newer, canonical copy | n/a | n/a | n/a |
| `apps/web/src/routes/login.stories.tsx` | `apps/web/src/stories/login.stories.tsx` | TanStack Router picks up everything in `routes/`; storybook file in `routes/` is wrong | Storybook config (`packages/ui/.storybook/main.ts` or web equivalent) | Verify no route is accidentally generated from the file. | Phase 3 |
| `apps/api/src/ingestion/poller.rs` | `apps/api/src/ingestion/poll_strategy.rs` | Disambiguate from `rivian_poll.rs` (which is the actual poller) | `ingestion/mod.rs` and any `use` statements | trivial | Phase 3 |
| `apps/api/src/services/geofences.rs` | *(delete; one-line wrapper)* | The file is a single `pub use models::geofence::*;` re-export | `services/mod.rs`, any importers | Replace imports with direct `crate::models::geofence::*`. | Phase 3 |
| Route `/v1/charging` (collection) | *(keep)* — but rename internal label "charging" → "charge sessions" in UI copy | UI consistency | `apps/web/src/routes/charging.*`, components | Backward-compatible (URL unchanged) | Phase 5 |
| Route `/v1/geofences` | *(keep DB term; expose only `/v1/places`)* — remove `geofences` from the public API surface or relegate to admin | One name per concept on the public API | `apps/web/src` (any caller), `packages/hooks/src/api.ts` | Need a public-API deprecation note if external API-key consumers exist. Recommend hard removal after one release cycle since this product is self-hosted single-tenant. | Phase 3 |
| Route `/v1/stats` | *(decide)* — see §E.1; likely fold into `/v1/overview` | Reduce ambiguity | Grep `apps/web` and `packages/hooks` for `/v1/stats` callers | If unused, hard-delete. | Phase 3 |
| Term "schedules" (charging vs departure) | Always qualify: "charge schedule" / "departure schedule" — never bare "schedule" in UI strings | UI clarity | grep for `Schedule` in `apps/web/src/components/dashboard/`, `packages/dashboards/src/widgets/` | Cosmetic | Phase 5 |
| Term "drive" vs "trip" | Pick **trip** everywhere user-facing; **drive mode** is the in-vehicle gear state | Avoid two terms | Several widget titles and dashboard defaults reference both | Cosmetic | Phase 5 |
| Files: `dev.sh` + `dev.mjs` | Keep both; document that `dev.sh` is a thin POSIX dispatcher to `dev.mjs` | Cross-platform fallback | None | n/a | n/a |

There is **no large-scale source rename** required. The naming hygiene is already good. The renames above are surgical.

---

## E. Dead Code, Legacy Logic, Fallbacks, and Duplication Findings

### E.1 Catalog (severity: H = blocks release confidence; M = should fix before v1; L = polish)

| # | Severity | File / module | Behavior | Why it's flagged | Evidence | Canonical replacement | Side effects | Action |
|---|---|---|---|---|---|---|---|---|
| E-1 | **H** | `apps/api/src/ingestion/rivian_auth.rs:162-165, 318-321, 378-381` | `.unwrap_or_default()` on Rivian token fields after login / OTP / refresh | Silently persists empty access/refresh tokens if the upstream payload is missing a field. Root-cause class for "vehicle stuck offline without errors". | Backend audit | Explicit `Option::ok_or_else(...)` returning a typed error; bubble to caller. | Forces callers to handle missing-token case; reveals UX gap on connect failure. | **Remove all `.unwrap_or_default()` on token strings in this file.** Add unit test for missing-field payloads. |
| E-2 | **H** | `apps/api/src/ingestion/rivian_poll.rs:136-172` (`try_refresh_tokens`) **and** `apps/api/src/routes/vehicles.rs:736-787` **and** `apps/api/src/services/charge_backfill.rs:205` | Three independent code paths decrypt credentials and call Rivian refresh | No single source of truth; concurrent refresh race; `vehicle_runtime_state.auth_state` and `vehicle_credentials` not updated transactionally | Backend audit; DB audit (0031 lacks state machine). | New `ingestion::session_store::refresh_and_persist(pool, redis, vehicle_id)` that takes a Redis lock keyed `rivian:refresh:<vehicle_id>` and updates credentials + auth_state in one DB transaction. | All three call sites delegate to one function. | **Centralize.** Add integration test that simulates two concurrent 401s and asserts a single refresh happens. |
| E-3 | **H** | `apps/api/src/ingestion/charge_detector.rs:317, 344, 375` and `trip_detector.rs:494, 498` | `panic!("expected ...")` on event-shape assertions on the live ingestion path | A malformed Rivian payload could crash the per-vehicle worker | Backend audit | Return `Result::Err(IngestionError::UnexpectedShape { ... })` and let supervisor restart with backoff. | Worker no longer aborts the process; supervisor counters increment. | Replace panics with typed errors; add regression test. |
| E-4 | **M** | `apps/api/src/routes/{geofences.rs, locations.rs, places.rs}` + `apps/api/src/services/geofences.rs` | Three routes over the same `riviamigo.geofences` table; `services/geofences.rs` is a one-line re-export | Confusing public surface; future maintainers cannot predict which to use | Backend audit; DB audit (one table only) | `places.rs` becomes the canonical CRUD surface; `locations.rs` stays for the read-only GPS-heatmap query (rename to `/v1/places/heatmap` or keep `/v1/locations/heatmap` but document it as a "view"); `geofences.rs` route is removed; `services/geofences.rs` file removed. | Frontend grep shows no `geofences` route callers; verify in Phase 3 before deletion. | See rename map above. |
| E-5 | **M** | `apps/api/src/routes/stats.rs` | Returns aggregated vehicle-summary numbers overlapping with `overview.rs` | **Decision: `/v1/overview` is canonical.** | Backend audit | `routes/overview.rs` is the canonical endpoint. | Remove route, router entry, and `useStats.ts` hook (or redirect). | **Phase 3: delete `routes/stats.rs`.** |
| E-6 | **M** | `apps/api/src/routes/data_quality.rs` | Telemetry coverage gap reporting | No frontend callers (`apps/web/src` grep negative) | Verified during audit | **Decision: delete.** Existing frontend data quality surfaces are sufficient. | None. | **Phase 3: delete `routes/data_quality.rs` and remove from router.** |
| E-7 | **M** | `apps/api/migrations/0026_clean_user_dashboards.sql` | One-time data cleanup of user dashboards (retires experimental widgets) | Data migration shipped as schema migration — risky on rollback; runs on every fresh DB unnecessarily | DB audit | Move to `apps/api/src/bin/repair_dashboard_widgets.rs` as a one-shot, idempotent script. Keep 0026 as a no-op migration (do not delete a numbered migration once shipped). | Existing DBs already ran it; new fresh DBs would not need to (no v1 widgets exist). | Phase 4. |
| E-8 | **M** | `apps/api/migrations/0024, 0025, 0029, 0030` | Charge enrichment split across 4 migrations | Migration churn; hard to reason about feature shape | DB audit | After v1 release, squash into `0001_baseline.sql`. Before that, document the chain in a header comment in 0029. | New deploys reuse baseline; existing deploys keep migration history. | Phase 4. |
| E-9 | **M** | `riviamigo.battery_capacity_snapshots` (created in 0002) | Never written, never read | CLAUDE.md explicitly states this. Worker reads battery capacity from `timeseries.telemetry`. | DB audit | **Decision: wire a daily worker snapshot** — one row per vehicle per day recording capacity, odometer, temp for long-term degradation tracking. | Requires verifying table schema has `capacity_kwh`, `odometer_km`, `outside_temp_c`, `vehicle_id`, `ts` columns; add migration if adjustment needed. Add daily job to `worker.rs`. | **Phase 3: implement daily snapshot job and verify/adjust table schema.** |
| E-10 | **M** | `riviamigo.service_events` (created in 0010) | No code references | DB audit | **Decision: keep and build Maintenance Log feature in Settings.** Add CRUD route + UI section with log-level selector for stdout (Docker baseline). | New route `routes/service_events.rs`, new Settings section component. | **Phase 3: implement Settings → Maintenance Log wired to `service_events` table.** |
| E-11 | **L** | `apps/web/src/routes/login.stories.tsx` | Storybook file misplaced in `routes/` | TanStack Router may try to generate a route from it | Frontend audit | Move to `apps/web/src/stories/login.stories.tsx`. | None | Phase 3. |
| E-12 | **L** | `apps/web/src/routes/settings.tsx` (1061 lines), `health.tsx` (773 lines), `connect.tsx` (262), `connect.otp.tsx` (254), `login.tsx` (172), `charging.$sessionId.tsx` (175), `trips.$tripId.tsx` (105) | Fat routes violating the "thin route" rule in CLAUDE.md | Maintenance friction; harder to test | Frontend audit | Extract into `components/{settings,connect,login,health}/` subcomponents. Settings already has `BackupSection.tsx`, `PlacesSection.tsx`; finish the split. | Test files may need renaming/duplicating per new component. | Phase 3, parallelizable. |
| E-13 | **L** | `apps/api/src/ingestion/poller.rs` (36 lines) vs `rivian_poll.rs` (~2000) | Naming confusion (`poller.rs` is just a `Duration` enum) | Rename to `poll_strategy.rs` | Backend audit | Pure rename | Update `ingestion/mod.rs` | Phase 3. |
| E-14 | **L** | `apps/api/Cargo.toml` `rsa` crate | Possibly unused (no `rsa::` references) | Backend audit | Run `cargo machete` or grep `use rsa` in `apps/api/src`. If absent, drop. | Smaller compile times and supply-chain surface. | Phase 3. |
| E-15 | **L** | Type narrowing casts: `apps/web/src/routes/charging.$sessionId.tsx:92`, `trips.$tripId.tsx:52-53` use `as unknown as { duration_*?: number }` | Backend response shape is missing a field that the UI needs | Frontend audit | Add `duration_min` / `duration_seconds` to the backend response types in `packages/types/src/api.ts` and the route handlers in `apps/api/src/routes/charging.rs` and `trips.rs`. | Coordinated backend + frontend change. | Phase 3. |
| E-16 | **L** | `apps/web/src/test/setup.ts` stubs canvas + Path2D + uPlot heavily | Over-mocking risk: chart-rendering regressions invisible to unit tests | Testing audit | Move to a single Playwright e2e "dashboard renders" smoke test that exercises real uPlot. Keep jsdom stubs but layer the e2e on top. | New Playwright dependency | Phase 8. |
| E-17 | **L** | `.env.example` `S3_*` keys (`GKdeadbeef...`, `deadbeef...cafe`) | Look like real keys; copy-pasted into dev compose; **devpassword** for Postgres same pattern | Security audit (HIGH #6, MEDIUM #12) | Replace with `<your-s3-access-key>` placeholders; generate dev passwords via a setup script. | Update README and CLAUDE.md to reference the script. | Phase 9 (security). |
| E-18 | **L** | `apps/api/src/routes/grafana.rs` | Stub-only Grafana datasource endpoint | Backend audit | **Decision: implement in full.** Build a proper Grafana JSON datasource backed by the metrics catalog and telemetry queries. | Must be tested and documented in Wiki "API Reference". | **Phase 3: implement complete Grafana datasource endpoint with tests.** |

### E.2 Fallbacks recommended for **retention** with justification

| Fallback | File | Why kept |
|---|---|---|
| Auto-generation of `JWT_SECRET`, `JWT_PUBLIC_KEY`, `AGE_ENCRYPTION_KEY` if missing | `apps/api/src/keys.rs`, `system_config` table | This is the documented dev convenience that makes `docker compose up` work on a fresh checkout. The fallback is gated by env vars being unset; production deployers supply them. Keep but document explicitly in `.env.example` and Wiki. |
| WebSocket reconnect backoff (`RIVIAN_WS_RECONNECT_*`) | `ingestion/supervisor.rs` and `ws_client.rs` | Handles real intermittent upstream failures from Rivian. Not legacy. |
| HTTP retry on 401 via `try_refresh_tokens` | `ingestion/rivian_poll.rs` | Genuine token refresh flow. The bug is duplication/coupling (E-2), not the existence of the fallback. |
| sqlx-offline mode | `apps/api/Dockerfile` (`SQLX_OFFLINE=true`) | Required for Docker builds without a live DB. Keep; commit `.sqlx/` metadata (currently missing — see §H). |
| Reverse proxy headers passthrough in nginx (`X-Forwarded-For`) | `infra/nginx/nginx.conf` | Needed for accurate rate limiting per IP. Tighten `set_real_ip_from` (§I-13) but keep the mechanism. |
| Auto-applied migrations on API boot | `apps/api/src/main.rs` | Operational simplicity for single-tenant self-hosted. Keep, but add a migration smoke job in CI (§H). |

---

## F. GitHub Wiki Information Architecture

### F.1 Current Wiki status

- The GitHub Wiki for `bballdavis/Riviamigo` is **not initialized**. No `*.wiki.git` remote can be cloned until at least one page is created on github.com.
- No local `.wiki` directory exists; no scripts publish to a Wiki.
- The Wiki repo lives at `https://github.com/bballdavis/Riviamigo.wiki.git` once initialized.

### F.2 Setup required (one-time)

1. On the GitHub repo settings page, ensure **Wiki** is enabled.
2. Create the Home page via the GitHub web UI to materialize the `.wiki.git` repo.
3. Clone `git clone https://github.com/bballdavis/Riviamigo.wiki.git wiki/` (sibling to the main repo, **not** inside it).
4. Add a top-level `wiki/` to the main repo's `.gitignore` so the two checkouts don't entangle.
5. Adopt the authoring workflow in §F.5.

### F.3 Sidebar / navigation

A `_Sidebar.md` page driving left-nav (visible on every page) plus a `_Footer.md` with the "Last reviewed" date and a link back to the repo README.

Proposed `_Sidebar.md`:

```markdown
**Getting started**
- [Home](Home)
- [Feature Overview](Feature-Overview)
- [Quick Start](Quick-Start)

**Installation**
- [Prerequisites](Prerequisites)
- [Docker Compose Deployment](Docker-Compose-Deployment)
- [Reverse Proxy & TLS](Reverse-Proxy-TLS)

**Configuration**
- [Environment Variables](Environment-Variables)
- [Database & Storage](Database-And-Storage)
- [Rivian Account Setup](Rivian-Account-Setup)
- [Token & Session Lifecycle](Token-And-Session-Lifecycle)

**Using Riviamigo**
- [Dashboards](Dashboards)
- [Charging History](Charging-History)
- [Cost Profiles & TOU Rates](Cost-Profiles-And-TOU-Rates)
- [Places (Home / Work / Favorite Chargers)](Places)
- [Trips & Efficiency](Trips-And-Efficiency)

**Operations**
- [Background Jobs & Backfills](Background-Jobs-And-Backfills)
- [Backups & Restore](Backups-And-Restore)
- [Upgrades](Upgrades)
- [Logs & Diagnostics](Logs-And-Diagnostics)
- [Troubleshooting](Troubleshooting)

**Reference**
- [API Reference](API-Reference)
- [Metrics Catalog](Metrics-Catalog)
- [Security Overview](Security-Overview)
- [Architecture Summary](Architecture-Summary)
- [FAQ](FAQ)

**Contributing**
- [Development Setup](Development-Setup)
- [Coding Conventions](Coding-Conventions)
- [Release Process](Release-Process)
```

### F.4 Page-level catalog

Status legend: **READY** = can be authored from current code; **BLOCKED** = depends on auth/charging remediation; **NEW** = green-field content.

| # | Title | Slug | Audience | Status | Source-of-truth refs | Notes |
|---|---|---|---|---|---|---|
| 1 | Home | `Home` | All | READY | `README.md`, `BRANDING.md` | One-page elevator pitch, screenshot, "Get started" button to Quick Start. |
| 2 | Feature Overview | `Feature-Overview` | End user | READY (most), BLOCKED for cost section | dashboard configs in `packages/dashboards/src/defaults/` | Group features by Dashboards / Charging / Trips / Battery / Places / Cost. Mark "Cost calculation" as pending until §K Phase 2 done. |
| 3 | Quick Start | `Quick-Start` | Self-hoster | READY | `README.md`, `scripts/dev.sh`, `infra/docker-compose.yml` | Single happy path: clone → compose up → register → connect Rivian. |
| 4 | Prerequisites | `Prerequisites` | Self-hoster | READY | `README.md` Prerequisites | OS, RAM, disk, Docker version. |
| 5 | Docker Compose Deployment | `Docker-Compose-Deployment` | Self-hoster | READY | `infra/docker-compose.prod.yml`, `infra/nginx/nginx.conf` | Production compose, env, volumes, networks. |
| 6 | Reverse Proxy & TLS | `Reverse-Proxy-TLS` | Self-hoster | READY | `infra/nginx/nginx.conf` | Certbot example; HSTS; trusted-proxy ranges (per §I-13). |
| 7 | Environment Variables | `Environment-Variables` | Self-hoster | READY *after* `.env.example` rewrite (§G.4) | `apps/api/src/config.rs` | Generated table: var name, default, required, description. Should be automated from code where possible. |
| 8 | Database & Storage | `Database-And-Storage` | Self-hoster | READY | `infra/docker-compose.*.yml`, migrations | TimescaleDB version, hypertable behavior, retention, Garage S3 for backups. |
| 9 | Rivian Account Setup | `Rivian-Account-Setup` | End user | BLOCKED on E-1, E-2 | `docs/RIVIAN_AUTH.md`, `routes/vehicles.rs` | Step-by-step OTP. Cannot ship until token persistence is reliable. |
| 10 | Token & Session Lifecycle | `Token-And-Session-Lifecycle` | Self-hoster | BLOCKED on E-1, E-2 | `ingestion/rivian_auth.rs`, `vehicle_runtime_state.auth_state` | Explain refresh cadence, what `auth_state` values mean, how to recover from `needs_reauth`. |
| 11 | Dashboards | `Dashboards` | End user | READY | `packages/dashboards/src/defaults/`, `docs/frontend/dashboard-authoring.md` (developer subset) | What ships by default; how to edit / clone / import / export. |
| 12 | Charging History | `Charging-History` | End user | BLOCKED on charge backfill remediation | `routes/charging.rs`, `services/charge_backfill.rs`, `bin/backfill_charge_session_ids.rs` | Cover backfill button and idempotency, gaps, manual re-run. |
| 13 | Cost Profiles & TOU Rates | `Cost-Profiles-And-TOU-Rates` | End user | BLOCKED on cost remediation | `routes/cost_profiles.rs`, `models/cost_profile.rs`, migration 0017 | TOU window definition, currency, effective_from/to. |
| 14 | Places | `Places` | End user | READY (mostly) | `routes/places.rs`, `components/settings/PlacesSection.tsx` | Naming-convention: "Places" is the user-facing term. |
| 15 | Trips & Efficiency | `Trips-And-Efficiency` | End user | READY | `routes/trips.rs`, `efficiency.rs` | |
| 16 | Background Jobs & Backfills | `Background-Jobs-And-Backfills` | Self-hoster | READY *partly* | `apps/api/src/bin/*` | Document each repair/backfill bin and when to use it. Note 4-bin charge enrichment chain is being centralized (link to remediation). |
| 17 | Backups & Restore | `Backups-And-Restore` | Self-hoster | READY | `routes/backups.rs`, migrations 0020/0021, `services/backups.rs` | |
| 18 | Upgrades | `Upgrades` | Self-hoster | READY | `infra/docker-compose.prod.yml`, migration auto-apply | Version-pinning, rollback strategy. |
| 19 | Logs & Diagnostics | `Logs-And-Diagnostics` | Self-hoster | READY | `routes/health.rs`, `routes/data_quality.rs` (after E-6) | Where logs go, RUST_LOG, health endpoint, Rivian stewardship counters. |
| 20 | Troubleshooting | `Troubleshooting` | Self-hoster | BLOCKED on E-1, E-2 | misc | "Vehicle stuck offline" requires resolved auth state to be useful. |
| 21 | API Reference | `API-Reference` | Integrator | READY | `README.md` API table, `routes/mod.rs`, `docs/api-access.md` | Generated from route inventory; group by surface. |
| 22 | Metrics Catalog | `Metrics-Catalog` | Integrator | READY | `routes/metrics.rs` (live catalog), `docs/metrics-reference.md` | Note the live catalog endpoint as canonical. |
| 23 | Security Overview | `Security-Overview` | Self-hoster / auditor | READY *after* §I HIGH items resolved | `docs/security.md`, §I of this document | Sanitized; do not include real key formats. |
| 24 | Architecture Summary | `Architecture-Summary` | New contributor | READY | `CLAUDE.md`, `docs/frontend/dashboard-architecture.md` | Diagram (Mermaid) of services + flow. |
| 25 | FAQ | `FAQ` | Everyone | READY | Aggregated from existing docs | "Why Rivian's unofficial API?", "How is my password stored?", "Can I run this on a Raspberry Pi?". |
| 26 | Development Setup | `Development-Setup` | Contributor | READY | `README.md`, `CLAUDE.md` | |
| 27 | Coding Conventions | `Coding-Conventions` | Contributor | READY | `CLAUDE.md` (subset) | |
| 28 | Release Process | `Release-Process` | Maintainer | NEW | n/a | Versioning, changelog, image tagging. |

### F.5 Authoring & drift-prevention workflow

1. **Draft in the main repo** under `docs/wiki-drafts/` (new directory). All authoring happens there in PRs.
2. A `scripts/publish-wiki.sh` script copies the drafts into the cloned Wiki repo (`wiki/`) and commits. Run manually after a PR merges and review confirms content matches landed code.
3. The Wiki repo never receives commits that bypass `docs/wiki-drafts/`. This guarantees Wiki is reproducible from main and avoids untracked drift.
4. Each Wiki page footer references a git SHA in `docs/wiki-drafts/<page>.md` so reviewers can see how stale the page is.
5. The CI `frontend` job adds a step `wiki-drift-check` that fails if a referenced env var, route, or migration filename in `docs/wiki-drafts/` no longer exists in the repo.

---

## G. Code Quality and Architecture Findings

### G.1 Module boundaries and coupling

**Finding G-1: Cross-layer coupling on Rivian token lifecycle.** As detailed in E-1 / E-2, three layers (route, ingestion supervisor, charge backfill service) each own a piece of the same workflow. The user has flagged this as the active concern; the architectural recommendation is:

- Make `ingestion::session_store` (currently the `age` encryption wrapper) the single authority for: load → decrypt → refresh-if-needed → persist → update `auth_state`.
- All callers (`worker.rs`, `routes/vehicles.rs`, `services/charge_backfill.rs`) call `session_store::get_or_refresh(vehicle_id).await?` and receive a typed `RivianSession` value. They never reach into `vehicle_credentials` directly.
- A Redis lock (`SETNX rivian:refresh:<vehicle_id>` with TTL) coordinates concurrent refresh.
- `auth_state` updates use the same SQL transaction as the `vehicle_credentials` upsert.

**Files affected:** `ingestion/session_store.rs` (expand), `ingestion/rivian_auth.rs` (keep low-level GraphQL only), `ingestion/rivian_poll.rs` (call session_store), `routes/vehicles.rs` (call session_store), `services/charge_backfill.rs` (call session_store), `models/vehicle.rs` (add `AuthState` enum with CHECK migration).

**Tests:** new integration test that simulates simultaneous 401s; unit test for the lock TTL; migration test for the new CHECK constraint.

### G.2 API client design (frontend)

**Finding G-2: `packages/hooks/src/api.ts` is a 859-line single class.** It works (recent commits removed merge-duplicates) but is now a candidate for splitting along resource boundaries: `auth.ts`, `vehicles.ts`, `charging.ts`, `trips.ts`, `dashboards.ts`, `places.ts`, `backups.ts`, `apiKeys.ts`. Each exposes a typed function; the `ApiClient` class becomes a thin facade. Keep a single transport (auth header, 401 retry, abort signal). Phase 3.

### G.3 State management

The Zustand auth store at `packages/hooks/src/useAuth.ts` is the only place that holds session state. The store correctly persists only `accessToken` and `defaultVehicleId` to localStorage (`partialize`). No parallel state holders were found. This is good.

**Finding G-3: `useVehicleStatus.ts` (322 lines)** manages the WebSocket live-status connection. It is large but coherent. Defer until a second consumer needs WebSocket logic; then extract a `useWebSocket` primitive in `packages/hooks/`.

### G.4 Configuration loading and validation

**Finding G-4: `apps/api/src/config.rs` uses `envy` to load directly into a struct.** It defaults missing values silently. There is no startup validation that, for production, certain fields are set (e.g., `AGE_ENCRYPTION_KEY` should not auto-generate in prod). Recommendation: introduce a `Config::validate(&self) -> Result<()>` that, when `RIVIAMIGO_ENV=production`, rejects auto-generated key paths and requires explicit `JWT_SECRET`, `JWT_PUBLIC_KEY`, `AGE_ENCRYPTION_KEY`, non-default `POSTGRES_PASSWORD`, and unset `COOKIE_INSECURE`. Fail fast on boot with a clear error. Add `RIVIAMIGO_ENV` to `.env.example` documented as either `development` (default) or `production`.

### G.5 Backend / frontend contracts

**Finding G-5: Two cast-through-unknown sites** at `apps/web/src/routes/charging.$sessionId.tsx:92` and `trips.$tripId.tsx:52-53` indicate the backend response shape is missing duration fields the UI needs. Add them to:
- `apps/api/src/routes/charging.rs` (charge session detail response: add `duration_minutes: i64`).
- `apps/api/src/routes/trips.rs` (trip detail response: add `duration_seconds: i64`).
- `packages/types/src/api.ts` mirror.
Remove the casts in the route components. Add API contract tests on both sides.

### G.6 Data models

**Finding G-6: `auth_state` (vehicle_runtime_state, mig 0031) has no CHECK constraint.** Add migration `0033_vehicle_auth_state_enum.sql` with `CHECK (auth_state IS NULL OR auth_state IN ('authorized','needs_reauth','reauth_in_progress','disconnected'))` and update `models/vehicle.rs` to use a `#[sqlx::Type]` enum.

**Finding G-7: `charge_sessions` has accumulated 30+ columns** across 0013, 0024, 0029. Most are nullable. After v1 release, consider a sub-table `charge_session_rivian_metadata` to separate "data we own" from "what Rivian reported". Not blocking.

### G.7 Jobs and workers

**Finding G-8: 11 one-shot bins in `apps/api/src/bin/`** (`backfill_*`, `recompute_*`, `repair_*`). They're production-grade but undiscoverable. Add a top-level `apps/api/src/bin/admin.rs` that lists them, or document each in Wiki page 16 (Background Jobs). Each bin should be idempotent and accept a `--vehicle <uuid>` filter. Verify and harden idempotency for `recompute_charging_costs.rs` and `repair_charge_sessions_from_telemetry.rs` (current state unknown).

**Finding G-9: charge backfill orphan-on-crash.** `vehicles.history_backfill_status` can hang in `'running'` forever if the worker crashes. Add:
- A `backfill_started_at` timestamp + a "lease" TTL (e.g., 1 hour).
- On claim, atomically reset stale leases (`UPDATE ... WHERE status='running' AND started_at < NOW() - INTERVAL '1 hour' RETURNING ...`).
- Add an audit row to a new `charge_backfill_runs` table for history (or reuse `security_events` if you want a single audit trail).

### G.8 Logging & error reporting

**Finding G-10: Several `.unwrap_or_default()` swallow errors** beyond the token-field cases:
- `cost_profile.rs:33` (TOU JSON deserialize → empty array)
- `rivian_poll.rs:388, 559, 845, 1291, 1632` (Rivian API arrays)
- `ws_client.rs:269, 324` (WS JSON parse)

For each, add a `tracing::warn!` with a sanitized context and a counter in `rivian_stewardship_counters` so silent degradation is observable.

### G.9 Maintainability / readability

**Finding G-11: Fat frontend routes** (E-12). The settings page in particular touches Vehicles, API Keys, Backups, Places, Units, Background Jobs. Each section is already a child component; the route should be ~50 lines mounting a tabbed shell.

**Finding G-12: `apps/api/src/routes/mod.rs` is the right place** for the router build but currently does rate-limit configuration, CORS, body-limit middleware, and security headers all in one function. Acceptable for v1; consider splitting into `routing.rs` + `middleware_stack.rs` post-v1.

---

## H. Testing and Quality-Gate Findings

### H.1 Inventory

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Backend integration | `apps/api/tests/{auth,backup}_integration.rs` | 2 files | Hidden behind `#[ignore]` markers; not run in CI by default |
| Backend unit | `apps/api/src/**/*.rs` | 119 occurrences across 20 modules | Strong coverage on `routes/auth.rs` (16), `ingestion/parser.rs` (12), `models/cost_profile.rs` (9) |
| Frontend route | `apps/web/src/routes/__tests__/*.test.tsx` | 15 files | Covers all routes except `admin.dashboards.tsx`, `health.tsx`, `d.$slug.tsx` |
| Frontend unit | `apps/web/src/test/*.test.{ts,tsx}` | 15 files | API client, dashboard API, registry, sensor chip, contract tests |
| Playwright e2e | `apps/web/tests/e2e/login.spec.ts` | 1 file | Smoke only |
| Package tests | `packages/*` | 0 | No tests in any shared package |

### H.2 Tooling

CI (`.github/workflows/ci.yml`) enforces:

- **frontend:** `pnpm typecheck`, `pnpm turbo lint`, Vitest with 70% statements/functions/lines / 65% branches, Storybook build, Playwright (one test).
- **backend:** `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `cargo llvm-cov` 70% line threshold.
- **security:** `cargo audit --deny warnings --deny unmaintained`, `pnpm audit --prod --audit-level=high`, Gitleaks, Semgrep (rust/ts/react/owasp).
- **docker-security:** Trivy on built image (non-blocking).
- **Dependabot:** cargo weekly, npm weekly, gh-actions monthly.

Strong baseline. Gaps in the next subsection.

### H.3 Gaps and target gates

| Gate | Current | Target |
|---|---|---|
| Backend integration tests in CI | `#[ignore]` excludes them | Run with a Postgres service container; un-ignore. Two existing files plus net-new for `vehicles`, `charging`, `cost_profiles`, `backfill`. |
| sqlx-offline metadata committed | `.sqlx/` not in repo | Commit `apps/api/.sqlx/` artifacts so Docker builds and `cargo check` work without DB. Add CI step `cargo sqlx prepare --check`. |
| Migration apply/revert smoke | None | New CI job `db-smoke`: `sqlx migrate run` then `sqlx migrate revert` (loop to zero) against an empty Postgres. |
| Prod-compose smoke | None | Nightly job: `docker compose -f infra/docker-compose.prod.yml up -d`, wait for healthcheck, `curl /health`. |
| Frontend coverage threshold | 70% / 65% branches | Hold at 70% but exclude `apps/web/src/test/mockPrimitives.tsx` and over-stubbed modules from numerator (currently inflate %). Add e2e coverage as a separate gate. |
| E2E coverage | 1 login test | Target 5–8 Playwright scenarios: (a) login + register, (b) add vehicle via connect + OTP (mocked Rivian server), (c) view default dashboards, (d) edit a dashboard, (e) view a charging session detail, (f) create a cost profile and link to a place, (g) trigger a charge backfill. |
| SAST custom rules | Semgrep generic rulesets | Add custom rule: ban `.unwrap_or_default()` in `apps/api/src/ingestion/rivian_auth.rs` and `apps/api/src/ingestion/rivian_poll.rs` (the patterns from E-1). |
| Secret-leakage in logs | None automated | Add Semgrep rule banning `tracing::*!(... ?access_token ?refresh_token ?password ?credentials ...)`. |
| SBOM | None | Add `cargo cyclonedx` and `pnpm cyclonedx` artifacts to CI; attach to releases. |

### H.4 Prioritized test-addition matrix

| Pri | Area | Existing | Add | Type | Files | Acceptance |
|---|---|---|---|---|---|---|
| 1 | Rivian token refresh (E-1/E-2) | partial unit | concurrent-refresh integration test; missing-token-field unit test | Integration + unit | `apps/api/tests/rivian_session_test.rs`, `apps/api/src/ingestion/rivian_auth.rs` | Two concurrent 401s → exactly one refresh persisted; missing-field payload returns error, not empty token |
| 2 | Charge backfill idempotency | none | integration test inserting duplicate sessions | Integration | `apps/api/tests/charge_backfill_test.rs` | Same payload twice → no duplicate rows, recomputed cost identical |
| 3 | Cost calculation TOU edge cases | unit (9 tests in `cost_profile.rs`) | DST transition; cross-window session; effective_from/to boundary | Unit | `apps/api/src/models/cost_profile.rs` | Sessions across spring-forward / fall-back compute correctly |
| 4 | Migration apply/revert | none | CI job | CI | `.github/workflows/ci.yml` | Migrations apply and revert cleanly on empty Postgres |
| 5 | OAuth happy path | unit + integration partial | Playwright with mocked Rivian | E2E | `apps/web/tests/e2e/connect-vehicle.spec.ts` + mock server | Connect → OTP → first telemetry received |
| 6 | Rate limit on `/auth/login` | none | smoke that 11th request in burst returns 429 | Integration | `apps/api/tests/rate_limit_test.rs` | 11th request within 6 seconds returns 429 |
| 7 | API-key revoke audit | none | unit | Integration | `apps/api/tests/api_keys_audit_test.rs` | Revoke writes a `security_events` row |
| 8 | Vehicle ownership cross-tenant | unit (helper) | integration: User A trying to read User B's vehicle data on each route | Integration | `apps/api/tests/vehicle_ownership_test.rs` | Every data route returns 403/404 for non-owner |
| 9 | Frontend admin.dashboards / health / d.$slug | none | route render tests | Unit (Vitest) | `apps/web/src/routes/__tests__/` | All routes have at least a render-without-crash test |
| 10 | uPlot real-render smoke | none (jsdom stub only) | Playwright on a dashboard with a chart | E2E | `apps/web/tests/e2e/dashboard.spec.ts` | Chart renders with non-zero size |

### H.5 Test infra improvements

- Build a `backend_test_fixtures` module under `apps/api/tests/common/` with builders for `TestUser`, `TestVehicle` (with encrypted creds), `TestTrip`, `TestChargeSession`, `TestGeofence`, `TestCostProfile`.
- Build a new `@riviamigo/test-utils` package exposing API response builders for the frontend.
- Replace `vi.doMock()` inside test bodies (`settings.test.tsx:342`) with hoisted `vi.mock()` at module scope.

---

## I. Security Review Findings

Findings are tagged with severity. Each maps to a concrete file:line. All credentials in this section are masked.

### I.1 CRITICAL

**I-1. Test age encryption key constant reachable from non-test build path.** `apps/api/src/routes/auth.rs:375` defines a literal `AGE-SECRET-KEY-…` for the `make_app()` test helper. Confirm the entire `make_app()` block is gated behind `#[cfg(test)]` (or a `#[cfg(any(test, feature = "test-fixtures"))]` that is **not** enabled in release). If the constant is reachable from any non-test path, move test keys to `apps/api/tests/common/keys.rs` (a file only the integration tests depend on) and ensure neither `cargo build --release` nor the Docker image link them.

**I-2. JWT validation leeway not explicitly pinned.** `apps/api/src/middleware/auth.rs:93-96` constructs `Validation::new(Algorithm::RS256)` and calls `set_issuer` but does not set `.leeway(0)`. `jsonwebtoken` 9.x default leeway is 60 seconds. Explicitly set `validation.leeway = 0;` (or document the chosen value) and add a unit test that an `exp+1s` token is rejected.

**I-3. No refresh-token rotation reuse detection.** `apps/api/src/routes/auth.rs:162-181` hashes the inbound refresh token, replaces it, and issues a new one. If an attacker replays the old token after rotation, the lookup fails silently (404/401). Recommendation:
- Add `used_at TIMESTAMPTZ` to `riviamigo.refresh_tokens`.
- On rotation, set `used_at = NOW()` instead of deleting; delete via a daily cleanup.
- If a presented token has `used_at IS NOT NULL`, treat as reuse: revoke all tokens for that user, write a `security_events` row of type `refresh_token_reuse_detected`, return 401.

**I-4. API-key create/revoke not audit-logged.** `apps/api/src/routes/api_keys.rs:145-197` and `199-218` succeed without writing a `security_events` row. Add `audit_log(pool, user_id, "api_key_created", details).await?;` to both. Without this, compromised sessions can silently provision long-lived keys.

### I.2 HIGH

**I-5. Inconsistent password policy comments / tests.** `apps/api/src/routes/auth.rs:54` enforces `len() < 12`, but test comments / older paths reference 8. Introduce `const MIN_PASSWORD_LEN: usize = 12;` and reference everywhere.

**I-6. S3 placeholder keys look real.** `.env.example:31-32`, `infra/docker-compose.yml:54-55` use `GKdeadbeef…`/`deadbeef…cafe`. Replace with `<your-s3-access-key>` style placeholders and add a one-shot `scripts/init-dev-env.{sh,ps1}` that generates random dev credentials into `.env.local`.

**I-7. Rivian error text logged verbatim.** `apps/api/src/ingestion/rivian_auth.rs:558-563` logs raw GraphQL error bodies. Rivian error messages can include user email or session context. Replace with structured logging: log only `error.code` and `error.path`, never the raw message.

**I-8. No rate limit on failed API-key authentication.** `apps/api/src/middleware/auth.rs:108-151` always hashes and queries the DB on every request. Add a Redis counter `apikey:fail:<ip>` with a small TTL; return 429 after N failures within a window.

**I-9. `COOKIE_INSECURE` is not explicitly cleared in prod compose.** `infra/docker-compose.prod.yml` reads env from the host; if `.env` from a dev machine is copied into prod, `COOKIE_INSECURE=1` leaks. Add `COOKIE_INSECURE: ''` (explicit empty) in the prod compose env block, and have the `Config::validate()` in §G.4 fail boot if `RIVIAMIGO_ENV=production` and `COOKIE_INSECURE` is truthy.

**I-10. JWT issuer is the bare string `"riviamigo"`.** Acceptable for a self-hosted single-tenant product but namespace it: `"https://github.com/bballdavis/riviamigo"` or `"riviamigo/v1"`.

### I.3 MEDIUM

**I-11. Global 64 KB body limit too uniform.** `apps/api/src/routes/mod.rs:142`. Set per-route: 8 KB for `/auth/*`, 64 KB for data CRUD, 32 MB for backup restore uploads (apply via a `RequestBodyLimitLayer` per `Router::nest`).

**I-12. `devpassword` hardcoded across dev compose + .env.example.** `.env.example:2`, `infra/docker-compose.yml:7,51`. Same remediation as I-6: random dev creds via setup script.

**I-13. nginx upstream hardcodes `127.0.0.1:3001`.** `infra/nginx/nginx.conf:33`. Should be `server api:3001` so Docker DNS handles container relocation.

**I-14. `set_real_ip_from 0.0.0.0/0`** in nginx config trusts any proxy. Tighten to the Docker internal bridge subnet, e.g., `172.16.0.0/12`, or only the known upstream.

**I-15. nginx CSP missing.** `infra/nginx/nginx.conf` sends HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, but no `Content-Security-Policy`. Add `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.openstreetmap.org; connect-src 'self' wss://api.rivian.com;` (verify map tile origins and any external CDN before locking down).

**I-16. nginx gzip disabled.** Negligible security impact but worth flagging in tandem; add `gzip on; gzip_types text/plain application/json text/css application/javascript;`.

**I-17. Container base images not digest-pinned.** `infra/docker-compose.prod.yml` uses `timescale/timescaledb:2.16.1-pg16`, `nginx:1.27-alpine`. Pin by SHA256 once a tested image is chosen; Trivy already scans the built image.

### I.4 LOW

**I-18. No Redis service in prod compose.** Implicit external Redis. Document that the operator must provide it and that it MUST be on a private network (Redis has no auth in dev compose). Add `REDIS_PASSWORD` support to `config.rs` and `docker-compose.prod.yml`.

**I-19. nginx `worker_processes auto`.** Fine; explicit value optional.

**I-20. Dependabot does not cover Docker images.** Pin and/or add `package-ecosystem: docker`.

**I-21. OTP / connect payload logging.** `ingestion/rivian_auth.rs:311-316` `RivianOtpChallenge` includes `email: String`. Audit every `tracing::*!` call site for incidental exposure; mark sensitive fields with `#[instrument(skip(...))]`.

### I.5 INFORMATIONAL (confirmed-good)

- Refresh tokens are stored as SHA256 hashes, not cleartext (`routes/auth.rs:302-318`).
- API keys are SHA256-hashed; only `rmigo_` prefix is stored cleartext for fast lookup.
- Argon2 with OsRng salt (`routes/auth.rs:244-254`).
- sqlx compile-time-checked queries; the one `format!`-in-SQL site (`routes/metrics.rs`) validates against an allowlist.
- CORS uses an explicit allowlist (`routes/mod.rs:72-82`).
- Vehicle ownership checks via a single helper in `db/vehicles.rs:5-22`, used uniformly.
- HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy all present in both nginx and app layers.
- Rivian credentials encrypted at rest with `age` X25519.

---

## J. Target Productized Repository State

After all phases complete, the repository should look like this.

### J.1 Canonical module layout

```
apps/
  api/
    src/
      main.rs, lib.rs, config.rs (with validate()), keys.rs, errors.rs
      bin/                   # one-shot repair tools, all idempotent, accept --vehicle filter
      routes/                # 22 routes after cleanup (geofences, stats, grafana removed/relabelled)
      middleware/
      models/                # auth_state as a typed enum
      services/              # weather kept (in use); geofences re-export removed
      ingestion/
        session_store.rs     # SINGLE source of truth for Rivian sessions
        rivian_auth.rs       # low-level GraphQL only, returns typed errors
        rivian_poll.rs       # calls session_store; never persists tokens directly
        worker.rs, supervisor.rs, ws_client.rs
        parser.rs, charge_detector.rs, trip_detector.rs
        poll_strategy.rs     # renamed from poller.rs
      db/
    tests/
      common/                # builders + Postgres fixtures
      *_integration.rs       # all un-ignored in CI
    migrations/
      0001_baseline.sql      # squashed
      000N_*.sql             # post-v1 migrations only
    .sqlx/                   # committed offline metadata
  web/
    src/
      routes/                # all <100 lines; login.stories.tsx removed from here
      stories/               # Storybook lives here
      components/{auth,connect,login,health,settings,dashboard,layout,feedback}/
      test/
    tests/e2e/               # 5–8 Playwright scenarios

packages/
  hooks/src/{api/,auth/,vehicles/,charging/,trips/,places/,dashboards/}
  dashboards/                # unchanged; schema v2 only
  ui/                        # unchanged
  types/                     # backed by an OpenAPI export if possible
  config/
  test-utils/                # NEW: shared API response builders

docs/
  rivian-auth.md             # renamed from RIVIAN_AUTH.md
  api-access.md
  security.md
  dashboard-data-map.md
  metrics-reference.md
  frontend/dashboard-architecture.md
  frontend/dashboard-authoring.md
  wiki-drafts/               # NEW: source of Wiki pages
  plans/riviamigo-productization-codebase-review-plan.md (this doc)

infra/                       # compose, nginx, garage — security tightened
scripts/
  dev.sh, dev.mjs            # cross-platform
  build.sh, build.ps1        # cross-platform
  start.sh, start.ps1
  init-dev-env.{sh,ps1}      # NEW: generates random dev creds
  publish-wiki.sh            # NEW

.github/
  workflows/ci.yml           # adds db-smoke, prod-compose-smoke, sqlx-prepare-check
  dependabot.yml             # adds docker ecosystem
```

### J.2 Canonical auth / data flow

1. User logs in → access JWT (15 min) + HttpOnly refresh cookie (30 days, rotated, reuse-detected).
2. User connects Rivian → `rivian_auth` GraphQL → tokens encrypted via `session_store` → persisted to `vehicle_credentials` + `vehicle_runtime_state.auth_state='authorized'` in one transaction.
3. Per-vehicle worker calls `session_store::get_or_refresh(vehicle_id)` for every Rivian API request. If a 401 returns, session_store takes the Redis lock, refreshes, persists atomically, releases.
4. Charge backfill, vehicle status, schedules, charging history all go through the same `session_store`.
5. `auth_state` transitions are: `authorized ↔ reauth_in_progress`, → `needs_reauth` (terminal until user re-OTPs), → `disconnected` (user explicitly removed vehicle).

### J.3 Supported deployment model

- Single self-hosted Docker Compose deployment (`infra/docker-compose.prod.yml`).
- Externally provisioned: `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_PUBLIC_KEY`, `AGE_ENCRYPTION_KEY`, `S3_*`, `REDIS_URL` (with auth), `ALLOWED_ORIGINS`.
- nginx terminates TLS, serves SPA, reverse-proxies API.
- `RIVIAMIGO_ENV=production` enforces the validation rules from §G.4.

### J.4 Retained operational fallbacks

Per §E.2: dev-mode JWT/age auto-generation, WS reconnect backoff, refresh-on-401 retry, sqlx-offline mode, auto-applied migrations, nginx forwarded-IP handling. Each is retained for a documented operational reason.

### J.5 Eliminated legacy paths

- `services/geofences.rs` re-export file.
- `routes/geofences.rs` public surface (folded into `places.rs`).
- `routes/stats.rs` (replaced by `/v1/overview`).
- `routes/data_quality.rs` (no frontend callers; existing surfaces sufficient).
- `login.stories.tsx` from routes directory (moved to `stories/`).
- All `.unwrap_or_default()` on Rivian token strings.
- All `panic!()` on detector event-shape mismatches.

**Kept / built (decisions resolved):**
- `routes/grafana.rs` → implement in full (Grafana JSON datasource).
- `battery_capacity_snapshots` → wire daily worker snapshot (degradation tracking).
- `service_events` → wire Settings → Maintenance Log feature.

### J.6 Naming and conventions

Per §D.1. Enforced by a custom `pnpm lint:naming` step in CI (a simple grep-based checker is sufficient) and a `cargo clippy` config.

### J.7 Mandatory gates before merge to `main`

- All CI jobs green (frontend, backend, security, docker-security, db-smoke, sqlx-prepare-check).
- Coverage thresholds met (70% backend lines, 70% frontend statements/functions/lines, 65% branches).
- No new `.unwrap_or_default()` on token / credential strings (Semgrep rule).
- No new direct calls to `vehicle_credentials` outside `session_store` (Semgrep rule).
- All migrations apply + revert cleanly.

---

## K. Ordered Implementation Plan

Phases are sequenced for safety. Each phase has explicit acceptance criteria and rollback notes.

### Phase 1 — Safety baseline (1–2 days)

**Objective:** Ensure changes can be made safely with fast feedback.

**Changes:**
1. Commit `apps/api/.sqlx/` offline metadata (`cargo sqlx prepare --workspace`). Add CI step `cargo sqlx prepare --check --workspace` to backend job.
2. Un-ignore the two integration tests in CI: add a Postgres service container to the backend job and run `cargo test -- --include-ignored`.
3. Add new CI job `db-smoke`: empty Postgres → `sqlx migrate run` → `sqlx migrate revert` to zero. Loop to verify reversibility.
4. Add custom Semgrep rules under `.semgrep/`:
   - Ban `.unwrap_or_default()` on `String` / `Option<String>` inside `apps/api/src/ingestion/rivian_*.rs`.
   - Ban direct `vehicle_credentials` table access outside `ingestion/session_store.rs` (will be applicable after Phase 2; mark as warning initially).
   - Ban `tracing::*!` interpolation of identifiers matching `(?i)(access_token|refresh_token|password|credential|otp|csrf)`.
5. Add `RIVIAMIGO_ENV` to `.env.example` with default `development`. Add `Config::validate()` (no enforcement yet, just structure).

**Files affected:** `.github/workflows/ci.yml`, `apps/api/.sqlx/`, `apps/api/src/config.rs`, `.semgrep/*.yml`, `.env.example`.

**Acceptance:** CI passes the new gates on `dev` as a no-op-otherwise baseline.

**Rollback:** Drop the new CI jobs; revert Semgrep config.

### Phase 2 — Rivian auth / token / charge enrichment / cost remediation (4–7 days)

This phase implements the user's known concern.

**Objective:** Single source of truth for vehicle sessions; reliable charge enrichment; deterministic cost calculation.

**Changes (ordered):**
1. Expand `apps/api/src/ingestion/session_store.rs` to expose `get_or_refresh(pool, redis, vehicle_id) -> Result<RivianSession>`. Internally:
   - Load encrypted creds; decrypt via age.
   - If access token's known expiry is past, take Redis lock `rivian:refresh:<vehicle_id>` (SETNX, 30s TTL), call `rivian_auth::refresh()`, persist atomically.
   - Update `vehicle_runtime_state.auth_state` in the same transaction.
2. Migration `0033_vehicle_auth_state_enum.sql`: add `CHECK (auth_state IN ('authorized','reauth_in_progress','needs_reauth','disconnected') OR auth_state IS NULL)`.
3. Refactor call sites:
   - `apps/api/src/ingestion/worker.rs`: replace direct decrypt with `session_store::get_or_refresh`.
   - `apps/api/src/ingestion/rivian_poll.rs:136-172`: remove `try_refresh_tokens`; delegate to `session_store`.
   - `apps/api/src/routes/vehicles.rs:736-787`: remove inline refresh; call `session_store`.
   - `apps/api/src/services/charge_backfill.rs:73-113,205`: remove inline decrypt + refresh; call `session_store`.
4. Replace `.unwrap_or_default()` on token strings in `apps/api/src/ingestion/rivian_auth.rs:162-165, 318-321, 378-381` with explicit `ok_or_else(|| RivianAuthError::MissingField("accessToken"))`. Bubble errors.
5. Replace `panic!()` in `charge_detector.rs:317, 344, 375` and `trip_detector.rs:494, 498` with typed errors and supervisor restart counters.
6. Charge backfill durability (G-9): add `backfill_started_at` to `vehicles`, add stale-lease reclaim, write to a new `riviamigo.charge_backfill_runs` audit table (migration `0034`).
7. TOU cost calculation hardening: add unit tests for DST transitions, effective_from/to boundaries, cross-window sessions. Fix any failures.
8. Add backend response fields `duration_minutes` (charge) and `duration_seconds` (trip); remove the two unknown-casts in frontend (E-15).
9. Add integration tests per §H.4 priorities 1–3.

**Files affected:** `apps/api/src/ingestion/{session_store,rivian_auth,rivian_poll,worker,charge_detector,trip_detector}.rs`, `apps/api/src/services/charge_backfill.rs`, `apps/api/src/routes/{vehicles,charging,trips}.rs`, `apps/api/src/models/{vehicle,charge_session,trip}.rs`, `apps/api/migrations/0033_*.sql`, `apps/api/migrations/0034_*.sql`, `apps/api/tests/rivian_session_test.rs`, `apps/api/tests/charge_backfill_test.rs`, `apps/api/tests/cost_tou_test.rs`, `packages/types/src/api.ts`, `apps/web/src/routes/charging.$sessionId.tsx`, `apps/web/src/routes/trips.$tripId.tsx`.

**Acceptance:**
- Two-concurrent-401 integration test passes; only one refresh persists.
- Missing-token-field payload returns a structured error and writes a `security_events`/`runtime_state` entry rather than silently persisting `""`.
- Duplicate charge payload backfill is idempotent.
- TOU DST tests pass.
- No `.unwrap_or_default()` on token strings remain; Semgrep enforces.
- All previously panicking detector paths return `Result` and the worker recovers.

**Rollback:** Revert the PR; data path unaffected because all changes are additive at the DB layer (CHECK constraint can be dropped; new audit table can be dropped). Old credentials remain decryptable.

### Phase 3 — Dead-code, duplicates, fat routes, naming (2–3 days)

**Objective:** Remove confusion-introducing code without behavior change.

**Changes:**
1. Delete `apps/api/src/services/geofences.rs` (one-line re-export); update imports.
2. Delete `routes/stats.rs`; `/v1/overview` is canonical. Update or remove `packages/hooks/src/useStats.ts` (redirect callers to overview hook or delete if unused).
3. Implement `routes/grafana.rs` in full — build a proper Grafana JSON datasource (SimpleJSON or Infinity-compatible) backed by the metrics catalog and telemetry queries. Add tests and document in Wiki "API Reference".
4. Delete `routes/geofences.rs` (hard remove); fold any missing CRUD into `routes/places.rs`. Keep `locations.rs` as `/v1/locations/heatmap` (read-only, separate concern).
5. Delete `routes/data_quality.rs` and remove from router (existing frontend surfaces are sufficient).
6. Move `apps/web/src/routes/login.stories.tsx` → `apps/web/src/stories/login.stories.tsx`.
7. Rename `apps/api/src/ingestion/poller.rs` → `poll_strategy.rs`.
8. Extract fat routes:
   - `apps/web/src/routes/settings.tsx` (1061 → ~50 lines) into a tabbed shell with section components. Include new **Maintenance Log** section wired to `riviamigo.service_events` with CRUD route + log-level selector for stdout (Docker baseline).
   - `apps/web/src/routes/health.tsx` (773 → ~50 lines) extracting `HealthDashboardContent.tsx`.
   - `apps/web/src/routes/connect.tsx` / `connect.otp.tsx` extracting form components.
   - `apps/web/src/routes/login.tsx` extracting `LoginForm.tsx`, `ThemeDetector.tsx`.
9. Split `packages/hooks/src/api.ts` into resource modules under `packages/hooks/src/api/` keeping the facade.
10. Wire `riviamigo.battery_capacity_snapshots` with a daily worker snapshot job: one row per vehicle per day recording `capacity_kwh`, `odometer_km`, `outside_temp_c`, `ts`. Add migration `0035_battery_snapshot_columns.sql` if the existing table schema needs adjustment. Add the snapshot job to `ingestion/worker.rs` or a dedicated daily task.
11. Wire `riviamigo.service_events` into Settings → Maintenance Log: add CRUD API route (`routes/service_events.rs`), add Settings section component, include log-level selector for stdout output.
12. Run `cargo machete` to confirm `rsa` (and any others) are unused; drop from `Cargo.toml`.

**Files affected:** mostly as above; full list in §L.

**Acceptance:**
- `cargo build` and `pnpm build` clean.
- `cargo machete` (or equivalent) shows zero unused deps.
- All frontend route tests still pass after extraction; coverage % unchanged or higher.
- API surface area is one term per concept (`places` not `geofences`+`places`+`locations` mixed publicly).

**Rollback:** Each removal is its own commit; revert specific commits if regressions surface.

### Phase 4 — Migration squash and one-time cleanup relocation (2 days)

**Objective:** Clean baseline for v1 release without losing existing-deploy migration history.

**Changes:**
1. Move `0026_clean_user_dashboards.sql` logic into `apps/api/src/bin/repair_dashboard_widgets.rs`; replace the migration body with a no-op (do NOT delete or renumber — existing deploys have already applied it).
2. Create `apps/api/migrations-baseline/0001_baseline.sql` representing the cumulative effect of 0001–0034 for new deployments. Keep the original numbered migrations for existing deployments.
3. Document in CLAUDE.md and Wiki "Upgrades" how a new deploy chooses the baseline vs. legacy migration path. The simplest approach: on a fresh DB the API runs the baseline; on a DB with existing rows in `_sqlx_migrations`, it continues with numbered migrations as today.
4. Verify the migration apply+revert smoke job (Phase 1) covers both paths.

**Files affected:** `apps/api/migrations/0026_clean_user_dashboards.sql`, `apps/api/migrations-baseline/0001_baseline.sql` (new), `apps/api/src/main.rs` (migration selection), `apps/api/src/bin/repair_dashboard_widgets.rs` (new), CLAUDE.md, Wiki drafts.

**Acceptance:** Fresh DB applies the single baseline; existing DB continues numbered migrations. Both paths reach the same final schema (verified by `pg_dump --schema-only` diff in CI).

**Rollback:** Keep using numbered migrations; the baseline file is dormant unless explicitly enabled.

### Phase 5 — Naming and documentation consolidation (1–2 days)

**Objective:** One naming convention; complete docs; no duplicates.

**Changes:**
1. Delete `docs/BRANDING.md` (duplicate); keep root `BRANDING.md`.
2. Rename `docs/RIVIAN_AUTH.md` → `docs/rivian-auth.md`. Update all inbound links (`README.md`, code doc comments).
3. Rewrite `.env.example` to include the six missing tuning knobs (§G.4 list), `RIVIAMIGO_ENV`, `REDIS_PASSWORD`, and remove `devpassword` / `deadbeef*` style values in favor of placeholder tokens.
4. Add `apps/web/.env.example` (frontend-only vars).
5. Add `scripts/build.ps1`, `scripts/start.ps1`, `scripts/init-dev-env.{sh,ps1}` for Windows users.
6. Update CLAUDE.md to reference the renamed doc and the new scripts.
7. Run a doc-link checker (e.g., `markdown-link-check`) to catch any broken references.

**Files affected:** `BRANDING.md`, `docs/BRANDING.md` (deleted), `docs/rivian-auth.md`, `README.md`, `CLAUDE.md`, `.env.example`, `apps/web/.env.example`, `scripts/*`.

**Acceptance:** Link checker passes; `.env.example` matches `Config` 1:1.

**Rollback:** Trivial; reverse the renames.

### Phase 6 — Wiki authoring and publish pipeline (3–5 days, but starts after Phase 2)

**Objective:** Publish the Wiki described in §F.

**Changes:**
1. Initialize the GitHub Wiki (web UI, create Home page).
2. Add `docs/wiki-drafts/` with one file per page in §F.4.
3. Add `scripts/publish-wiki.sh` that mirrors `docs/wiki-drafts/` to a sibling Wiki clone and pushes.
4. Add `wiki-drift-check` CI step that validates env var names, route paths, and migration filenames referenced in drafts still exist in the repo.
5. Author pages in the order specified in §M.

**Acceptance:** All 28 pages live on the Wiki, sidebar navigation works, `wiki-drift-check` green.

**Rollback:** Wiki is content-only; no application impact.

### Phase 7 — Testing and quality-gate hardening (3–4 days)

**Objective:** Reach the gate matrix in §H.

**Changes:**
1. Add prod-compose smoke (nightly CI).
2. Add Playwright scenarios for the 5–8 flows listed in §H.4 priority 5/10.
3. Add `packages/test-utils/` with API response builders.
4. Replace `vi.doMock()` inside test bodies with hoisted `vi.mock()` calls.
5. Backend test fixtures module under `apps/api/tests/common/`.
6. Raise frontend coverage by tightening exclusions; aim for stable 75%+.
7. Add `cargo cyclonedx` + `pnpm cyclonedx` SBOM generation, upload as CI artifacts.

**Acceptance:** All gates in §H.3 green.

### Phase 8 — Security remediation (2–4 days)

**Objective:** Resolve all CRITICAL and HIGH security findings.

**Changes (in §I order):**
1. I-1: Gate test age key behind `#[cfg(test)]` confirmed; move to `apps/api/tests/common/keys.rs`.
2. I-2: Pin JWT leeway to 0 (or document).
3. I-3: Add refresh-token reuse detection + `used_at` column (migration `0036_refresh_token_reuse.sql`).
4. I-4: Audit-log API-key create/revoke.
5. I-5: `const MIN_PASSWORD_LEN: usize = 12;`.
6. I-6 & I-12: Replace dev placeholder secrets in compose + env example; add init script.
7. I-7: Sanitize Rivian error logging.
8. I-8: Redis-counter rate limit on failed API-key auth.
9. I-9: Explicit `COOKIE_INSECURE: ''` in prod compose; enforce in `Config::validate()` when `RIVIAMIGO_ENV=production`.
10. I-10: Namespace JWT issuer.
11. I-11: Per-route body limits.
12. I-13–I-17: nginx tightening (`server api:3001`, trusted-proxy CIDR, CSP, gzip, base-image SHA pinning).
13. I-18: Document Redis security requirements; add `REDIS_PASSWORD`.
14. I-20: Docker Dependabot ecosystem.
15. I-21: Audit and skip OTP/email fields in tracing instrumentations.

**Acceptance:** Re-run the security audit checklist; all CRITICAL and HIGH items closed. Add a regression test for I-3 (reuse detection).

### Phase 9 — Release-readiness verification (1 day)

Walk through §N item-by-item, file a release issue, tag `v1.0.0-rc1`, dry-run a deploy to a staging VM.

---

## L. Deletion and Migration Safety Matrix

| Item | Change | Reason | Current refs / users | Replacement | Migration | Test-server adj. | Rollback | Validation |
|---|---|---|---|---|---|---|---|---|
| `apps/api/src/services/geofences.rs` | Delete | One-line re-export; dead wrapper | Files `use`-ing it | `use crate::models::geofence::*;` direct | none | none | `git revert` | `cargo build` passes |
| `apps/api/src/routes/geofences.rs` (public surface) | Internalize into `places.rs` or remove | Three routes one table | Frontend grep: verify zero callers | `routes/places.rs` is canonical | none | none | revert PR | grep produces no callers; API integration tests pass |
| `apps/api/src/routes/stats.rs` | **Delete** | `/v1/overview` is canonical (decided) | `packages/hooks/src/useStats.ts`, `apps/web` callers | `routes/overview.rs` | none | Update or remove `useStats.ts` | revert PR | `cargo build` + `pnpm build` green |
| `apps/api/src/routes/grafana.rs` | **Implement in full** | Build proper Grafana JSON datasource (decided) | None currently | Full Grafana datasource with tests | none | none | revert PR | Grafana can query; integration test passes |
| `apps/api/src/routes/data_quality.rs` | **Delete** | No frontend callers; existing surfaces sufficient (decided) | Verified none | n/a | none | none | revert PR | `cargo build` passes |
| `apps/api/src/ingestion/poller.rs` → `poll_strategy.rs` | Rename | Naming confusion with `rivian_poll.rs` | `ingestion/mod.rs` import | renamed file | none | none | revert | `cargo build` passes |
| `apps/web/src/routes/login.stories.tsx` → `apps/web/src/stories/login.stories.tsx` | Move | Storybook file inside router scan path | Storybook config | moved file | none | none | revert | Storybook builds; no extra route generated |
| `docs/BRANDING.md` | Delete | Duplicate of root | Inbound: verify none | Root `BRANDING.md` | none | none | restore from git | `markdown-link-check` |
| `docs/RIVIAN_AUTH.md` → `docs/rivian-auth.md` | Rename | Convention | `README.md` (2 links), code comments | renamed | none | none | revert | Link check green |
| `riviamigo.battery_capacity_snapshots` | **Wire daily snapshot job** (keep table; add worker job + possible schema migration) | Never written but table exists; decision: populate for degradation tracking | none currently; will add worker code + possible mig 0035 for schema adjustment | Daily snapshot in `worker.rs` | Schema migration if columns need adjustment | applied automatically | revert worker code + migration | Verify daily rows appear; schema diff clean |
| `riviamigo.service_events` | **Wire Settings → Maintenance Log** (keep table; add route + UI) | No code refs but table exists; decision: build the feature | none currently; will add `routes/service_events.rs` + Settings UI section | CRUD API route + frontend component | none (table schema already exists) | none | revert route + UI code | Maintenance Log appears in Settings; CRUD works |
| `apps/api/migrations/0026_clean_user_dashboards.sql` | Replace body with no-op + move logic to bin | Data cleanup in schema migration | Existing deploys already applied it | `bin/repair_dashboard_widgets.rs` | one-time script run post-deploy | none on existing | restore SQL | bin re-run yields no changes |
| `.unwrap_or_default()` on Rivian token strings | Replace with `Result` propagation | Critical correctness bug | Internal call sites | typed error + caller handling | none | none | revert per call site | Phase 2 integration test |
| `panic!()` in detectors | Replace with `Result` | Crashes worker | Internal | typed error | none | none | revert | Phase 2 detector test |
| `Cargo.toml` `rsa` dep (if unused) | Drop | Supply chain hygiene | grep `use rsa` | none | none | none | revert | `cargo build` |
| `apps/api/src/routes/auth.rs:375` test-key constant | Move to `tests/common/keys.rs` | Encryption key reachable from non-test builds | Internal test helper | test-only module | none | none | revert | `cargo build --release` no longer references key |

---

## M. GitHub Wiki Page Build Plan

### M.1 Build order

Wave 1 (READY, foundational — author first):
1. Home
2. Feature Overview
3. Quick Start
4. Prerequisites
5. Architecture Summary
6. Coding Conventions
7. Development Setup

Wave 2 (READY, reference):
8. Environment Variables (after Phase 5 `.env.example` rewrite)
9. Docker Compose Deployment
10. Reverse Proxy & TLS
11. Database & Storage
12. API Reference
13. Metrics Catalog
14. Backups & Restore
15. Upgrades
16. Background Jobs & Backfills
17. Dashboards
18. Places
19. Trips & Efficiency
20. Coding Conventions, Release Process

Wave 3 (BLOCKED on Phase 2):
21. Rivian Account Setup
22. Token & Session Lifecycle
23. Charging History
24. Cost Profiles & TOU Rates
25. Troubleshooting

Wave 4 (READY *after* Phase 8 security work):
26. Security Overview
27. Logs & Diagnostics
28. FAQ

### M.2 Source-of-truth references per page (highlights)

| Page | Inputs |
|---|---|
| Environment Variables | `apps/api/src/config.rs`, `.env.example`. Best implemented by a script that parses the struct doc-comments and emits markdown. |
| API Reference | `apps/api/src/routes/mod.rs` (route wiring), `routes/*.rs` (handlers), `docs/api-access.md`, `routes/metrics.rs` /v1/metrics/catalog dynamic. |
| Metrics Catalog | `routes/metrics.rs` allowlist + live `/v1/metrics/catalog`. |
| Token & Session Lifecycle | After Phase 2: `ingestion/session_store.rs`, migration 0033 enum values, `vehicle_runtime_state.auth_state`. |
| Cost Profiles & TOU Rates | `models/cost_profile.rs`, migrations 0008/0017/0032, `services/cost.rs`. |
| Backups & Restore | `services/backups.rs`, `routes/backups.rs`, migrations 0020/0021. |
| Dashboards | `packages/dashboards/src/defaults/`, `docs/frontend/dashboard-authoring.md` (developer subset). |
| Security Overview | `docs/security.md` + post-Phase-8 §I closures. |
| Architecture Summary | `CLAUDE.md`, this document §B + a Mermaid sequence diagram of the connect→OTP→ingestion flow. |

### M.3 Page outlines (samples)

**Rivian Account Setup** (BLOCKED):
- Prerequisites
- Step 1: Riviamigo account creation
- Step 2: `Settings → Add Vehicle`
- Step 3: Enter Rivian credentials (note: stored encrypted with age)
- Step 4: OTP from Rivian app
- Step 5: First telemetry (expect within 30s)
- What `auth_state` values mean (link to Token & Session Lifecycle)
- Troubleshooting "vehicle stuck offline"

**Token & Session Lifecycle** (BLOCKED):
- Three tokens: Riviamigo JWT, Riviamigo refresh cookie, Rivian session bundle.
- Lifetimes: 15 min / 30 days / Rivian-managed.
- Auto-refresh behavior (post-Phase-2).
- State machine diagram: `authorized → reauth_in_progress → authorized | needs_reauth`.
- Manual recovery: re-do OTP via Settings.
- Logs to look at.

**Environment Variables** (READY post-Phase-5):
- Required: `DATABASE_URL`, `REDIS_URL`, `ALLOWED_ORIGINS`, `RIVIAMIGO_ENV`.
- Required in prod: `JWT_SECRET`, `JWT_PUBLIC_KEY`, `AGE_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`.
- Optional: `S3_*`, `BACKUP_*`, `RIVIAN_WS_RECONNECT_*`, `RIVIAN_RAW_EVENT_RETENTION_DAYS`, `RIVIAN_PERSIST_RAW_EVENTS`, `RIVIAN_SUPPRESS_DUPLICATE_TELEMETRY`, `RUST_LOG`, `COOKIE_INSECURE` (dev only), `REDIS_PASSWORD`.

### M.4 Publish workflow

Per §F.5: PR → `docs/wiki-drafts/` → review → run `scripts/publish-wiki.sh` from a maintainer machine → Wiki updated. `wiki-drift-check` runs on every PR that touches drafts.

### M.5 Validation criteria

- Every env var named in a Wiki page exists in `Config`.
- Every API path named in Wiki exists in `routes/mod.rs`.
- Every migration filename referenced exists.
- Every screenshot has a matching asset under `docs/wiki-drafts/assets/`.
- No real credentials or tokens appear in any page.

---

## N. Release-Readiness Definition of Done

The release is ready when **every** one of these is true:

1. **Code paths:** No `panic!()` on Rivian event-shape mismatch. No `.unwrap_or_default()` on token strings. No duplicate Rivian-token refresh code paths. No public API routes for `geofences` (replaced by `places`). No dead routes (`stats` / `grafana` / `data_quality`) lingering without product justification.
2. **Auth correctness:** Two concurrent 401s produce a single refresh persisted (integration test green). `vehicle_runtime_state.auth_state` is updated atomically with credentials. The CHECK constraint exists.
3. **Charge backfill:** Idempotent on duplicate payloads (integration test). No "running" status hangs longer than the lease TTL.
4. **Cost calculation:** TOU sessions across DST boundaries and `effective_from/to` edges compute correctly (unit tests).
5. **Environment variables:** `.env.example` documents every var read by `Config`. `Config::validate()` rejects insecure config when `RIVIAMIGO_ENV=production`.
6. **Documentation:** No contradictory setup pages. No duplicate `BRANDING.md`. README, CLAUDE.md, and `docs/` agree with the code. Wiki Waves 1–4 published. `wiki-drift-check` green on `main`.
7. **Security:** All CRITICAL and HIGH findings from §I are closed. Refresh-token reuse detection is in place. API-key create/revoke writes audit rows. Test age key is `#[cfg(test)]`-only. Per-route body limits set. CSP header present. nginx upstream uses container DNS. `set_real_ip_from` is tightened.
8. **Testing:** Backend integration tests run in CI; coverage ≥70% lines. Frontend coverage ≥70% statements/functions/lines, ≥65% branches. Migration apply+revert smoke green. Prod-compose smoke green nightly. At least 5 Playwright scenarios green.
9. **Operational:** A fresh deploy via `docker-compose.prod.yml` reaches a healthy state with only documented env vars set. A fresh DB applies the squashed baseline. An existing DB continues numbered migrations to the same schema.
10. **Secrets:** No real-looking dev credentials in `.env.example` or compose. `devpassword` and `deadbeef*` removed. Init script generates random dev credentials. SBOM artifacts attached to the release.
11. **No release-blocking known-broken behavior:** Either the behavior is fixed, or it is explicitly documented as out-of-scope for v1 with a Wiki banner.

---

## O. Product Decisions — Resolved

All 10 product decisions were resolved on 2026-05-23. Decisions are recorded here as the authoritative reference for implementation.

| # | Question | Decision | Impact on plan |
|---|---|---|---|
| 1 | `service_events` table | **Keep; build Maintenance Log feature in Settings.** Include log-level selector for stdout (Docker as baseline log viewer). | Phase 3: wire `service_events` into Settings instead of dropping; add CRUD route + UI section. |
| 2 | `/v1/grafana/*` endpoint | **Implement in full.** | Phase 3: implement the Grafana datasource endpoint completely instead of removing the stub. |
| 3 | `/v1/data_quality` route | **Remove.** Existing frontend data quality surfaces are sufficient. | Phase 3: delete `routes/data_quality.rs` and remove from router. |
| 4 | `/v1/stats` vs `/v1/overview` | **`/v1/overview` is canonical; remove `/v1/stats`.** | Phase 3: delete `routes/stats.rs`, remove from router, update `packages/hooks/src/useStats.ts` to point at overview (or delete hook if unused). |
| 5 | `/v1/geofences` public surface | **Hard remove; `/v1/places` only.** No deprecation period. | Phase 3: delete `routes/geofences.rs`, fold any needed CRUD into `routes/places.rs`. |
| 6 | Cost UI with missing data | **Show blank / "—"; do not estimate.** | Affects Wiki "Cost Profiles" page copy and frontend charge-session detail: leave blank fields as-is, no fallback estimation. |
| 7 | Wiki vs `docs/` canonical scope | **Wiki = end-user / self-hoster canonical. `docs/` = developer canonical.** Confirmed. | No change to plan. |
| 8 | `COOKIE_INSECURE` in production | **`Config::validate()` hard-rejects it when `RIVIAMIGO_ENV=production`.** Confirmed. | Phase 8 (security): wire the validation. |
| 9 | Migration squash strategy | **Dual-baseline confirmed.** New deploys use squashed `0001_baseline.sql`; existing deploys keep numbered migrations. | Phase 4: implement as planned. |
| 10 | `battery_capacity_snapshots` | **Wire a daily worker snapshot** (one row/day: capacity, odometer, temp) for long-term degradation tracking. | Phase 3: instead of dropping the table, add a daily snapshot job in `worker.rs` and verify the table schema has the right columns (`capacity_kwh`, `odometer_km`, `outside_temp_c`, `vehicle_id`, `ts`). Add migration if columns need adjustment. |

---

*End of plan.*
