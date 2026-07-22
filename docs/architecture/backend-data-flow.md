# Backend Data Flow

## Audience

Backend contributors changing auth, ingestion, storage, or route behavior.

## Source Of Truth

This document is canonical for the high-level backend flow. Update it when the API runtime path or ingestion architecture changes materially.

## Flow Summary

1. User authenticates with Riviamigo through the auth routes.
2. Vehicle credentials and session state are stored by the API.
3. Per-vehicle ingestion workers maintain Rivian connectivity through WebSocket and supporting poll flows, with a watchdog that restarts a collector if the WebSocket stream goes silent while still holding the worker lock.
4. Parsed telemetry updates a canonical `vehicle_latest_status` row using per-field Rivian timestamps so older partial payloads cannot overwrite fresher SoC, range, charge-state, or odometer values.
5. Supporting poll flows reconcile completed charging sessions and live charge-curve data into canonical `charge_sessions`, preserving telemetry-backed windows as the public session timeline while storing Rivian aliases and API-only history as enrichment evidence.
6. API routes expose typed data to the frontend through `packages/types` and `packages/hooks`.
7. Completed trips enqueue an idempotent weather-enrichment job. The worker samples the exact route at endpoints and 15-minute intervals, derives rounded provider cells, batches Open-Meteo requests, stores `trip_weather_samples`, and updates the time-weighted `trips.outside_temp_c` summary used by trip and efficiency APIs.

Telemetry is written to the `timeseries.telemetry` hypertable. The
`telemetry_1min` continuous aggregate incrementally materializes the prior
seven days once an hour, ending five minutes before the present. It remains a
real-time aggregate, so queries include the unmaterialized recent tail from
the hypertable. This keeps active dashboards and charge curves current without
running a refresh every five minutes. Do not stretch this policy to 12 hours or
daily: doing so makes dashboard reads carry an increasingly large raw-data
tail. `odometer_daily` has a separate hourly, materialized-only policy.

Optional outbound services are governed by `external_connection_settings`, not environment variables. Weather and Nominatim execute on the server. Basemap and Iconify browser requests terminate at authenticated same-origin proxy routes. Custom endpoints are validated before storage, secrets are age-encrypted and write-only, and disabling a provider is enforced at the shared service seam.

Experimental Parallax protobuf discovery is intentionally kept out of the
production ingestion worker. The local `graph-exploration` harness owns that
read-only subscription and stores captures outside the application database;
only verified fields should later be promoted through the normal typed
telemetry path.

## Major Backend Areas

- `apps/api/src/routes`
  Public HTTP surface.
- `apps/api/src/ingestion`
  Rivian auth integration, WebSocket/poll workers, parser, detector logic.
- `apps/api/src/services`
  Shared backend business logic.
- `apps/api/src/models`
  DB-facing types and helpers.
- `apps/api/migrations`
  Schema evolution.

## Operational Rules

- New env vars must be reflected in `compose/.env.full.example`, the short Compose template when needed, and any relevant user-facing docs.
- New routes or route removals must update the relevant developer docs and any public-facing API references.
- Changes to auth, ingestion, or backup behavior must update runbooks if maintainers will need new recovery steps.

## Adjacent Docs

- [`../rivian-auth.md`](../rivian-auth.md)
- [`../api-access.md`](../api-access.md)
- [`../security.md`](../security.md)
- [`overview.md`](./overview.md)
