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

The API can also run an experimental, read-only Parallax capture alongside the
legacy vehicle-state WebSocket. Raw Parallax events are stored separately in
`riviamigo.rivian_parallax_events` with the RVM topic, server/receive
timestamps, base64 protobuf payload, and the active trip or charge-session ID
when one is available. This is a discovery store, not part of the typed
telemetry contract; `RIVIAN_PARALLAX_CAPTURE_ENABLED` controls it and the
normal raw-event retention setting removes old rows. Decode and analyze these
payloads offline before promoting any field into production telemetry.

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
