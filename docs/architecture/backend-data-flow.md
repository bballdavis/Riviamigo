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
5. Supporting poll flows reconcile completed charging sessions and live charge-curve data so recent vendor/cost metadata can land even when live telemetry has already ended.
6. API routes expose typed data to the frontend through `packages/types` and `packages/hooks`.

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

- New env vars must be reflected in `.env.example` and any relevant user-facing docs.
- New routes or route removals must update the relevant developer docs and any public-facing API references.
- Changes to auth, ingestion, or backup behavior must update runbooks if maintainers will need new recovery steps.

## Adjacent Docs

- [`../rivian-auth.md`](../rivian-auth.md)
- [`../api-access.md`](../api-access.md)
- [`../security.md`](../security.md)
- [`overview.md`](./overview.md)
