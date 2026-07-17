---
title: Riviamigo integration API
description: Create and use read-only, vehicle-scoped Riviamigo integration keys.
slug: /reference/api-access/
sidebar_label: Integration API
---

# Riviamigo integration API

Riviamigo integration keys are read-only, bearer tokens scoped to one vehicle.
Create and revoke them in **Settings > API Access**. The secret is shown once;
store it in the integration's secret store rather than in a dashboard or source
file.

The Settings inventory preserves legacy `view`, `edit`, or `admin` values as
`legacy_unmigrated` compatibility state while the database catches up. Those
values are never treated as read access; restart the current API build so its
pending migrations can normalize them, or rotate the affected key.

The API is intentionally not an automation or dashboard-management API.
Connecting a Rivian account, changing vehicle settings, creating dashboards,
and every administrative operation require a signed-in browser session.

Integration keys use the same bounded-feed philosophy as the dashboard data
paths: a small typed inventory, explicit vehicle scope, server-side time and
point limits, and specialized responses for dense history. They do not imply
access to arbitrary JSON paths or retained inbound Rivian payloads.

External provider policy follows that same boundary. Signed-in users can read `GET /v1/settings/external-connections`; administrator or super-user sessions are required for `PUT /v1/settings/external-connections/{id}`, `POST /v1/settings/external-connections/{id}/test`, and `POST /v1/settings/external-connections/disable-optional`. Provider secrets are accepted on writes but never returned.

## Authentication and scope

Send the key with every request:

```powershell
$apiKey = 'rmigo_REPLACE_ME'
$baseUrl = 'http://localhost:3001'
$headers = @{ Authorization = "Bearer $apiKey" }
```

The key can read only the vehicle selected when it was created. Requests for a
different `vehicle_id` return `403 Forbidden`, and `GET /v1/vehicles` returns
only the scoped vehicle. Keys never authorize `PUT`, `PATCH`, or `DELETE`.
`POST /v1/metrics/batch` is permitted because it is a bounded read query.

## Machine-readable catalog

Use the catalog as the current endpoint index. It requires the same bearer key
and is generated from the server's integration-read policy:

```powershell
Invoke-RestMethod -Headers $headers -Uri "$baseUrl/v1/api/catalog"
```

The catalog includes method, path template, whether a vehicle scope is
required, and purpose. It deliberately omits session-only and administrative
routes.

## Read surface

| Group | Endpoints |
|---|---|
| Vehicle | `GET /v1/vehicles`; `/v1/vehicles/{id}/status`, `/images`, `/raw-data`, `/telemetry/lanes`, `/health`, `/idle-drain`, `/state-timeline`, `/locations`, `/live-session`, `/charging-schedule`, `/departure-schedules`, `/wallboxes`, `/ota-details`, and `/backfill-status` |
| Battery | `GET /v1/battery/soc`, `/range`, `/capacity`, `/health`, `/mileage`, `/phantom-drain`, `/degradation` |
| Metrics | `GET /v1/metrics/catalog`, `/value`, `/series`; `POST /v1/metrics/batch` |
| Trips | `GET /v1/trips`, `/trips/map`, and `/trips/{id}` with `/detail`, `/track`, `/speed`, `/elevation`, `/power`, or `/series`; `GET /v1/vehicles/{id}/drives/{trip_id}/power` is the path-scoped power alias |
| Charging | `GET /v1/charging`, `/summary`, `/chart-series`, `/curve-analysis`, and individual session/curve routes; path-scoped aliases are available below `/v1/vehicles/{id}/charging-sessions` and `/costs` |
| Efficiency | `GET /v1/efficiency/summary`, `/by-mode`, `/trend`, `/vs-temp`, `/range-vs-temp` |
| Overview | `GET /v1/dashboard/overview/{vehicle_id}` and `GET /v1/vehicles/{id}/live-session` |
| Grafana compatibility | `GET /v1/grafana`; `POST /v1/grafana/search`, `/query`, `/annotations`, `/tag-keys`, `/tag-values` |

Trip detail responses include a `power` metadata object. Its `source` is
`direct`, `estimated_soc`, or `unavailable`; estimated samples are signed net
pack power in kW (positive discharge, negative net regeneration) and include
the median/p90 SoC interval plus estimated coverage. The `/power` and `/series`
responses carry the same provenance per point through `estimated_net_power_kw`
and `power_source`. Estimated values are averaged between SoC updates and do
not represent short acceleration or braking peaks.

## Raw telemetry explorer

`GET /v1/vehicles/{id}/telemetry/lanes` is the preferred high-density history
surface. It returns a bounded, server-bucketed time spine plus explicitly
allowlisted numeric lanes (`battery`, `drive`, `location`, `climate`,
`charging`, and `health`). Select up to four lanes with `lanes`, choose
`resolution=auto|1m|5m|1h`, and cap the response with `max_points` (64-512).
The response is designed for charts and map-adjacent views; it is approximate
when bucketed and preserves sparse values as nulls.

`GET /v1/vehicles/{id}/raw-data` remains the compatibility and detail surface.
It keeps the normalized `samples` array and supports `from`, `to`, `page`,
`per_page` (or legacy `limit`), `search`, comma-separated `fields`, and
`populated_only=true`. Its `field_coverage` response is a typed array of
`{ field, sample_count }` records, not a wide dynamically constructed JSON
object. Pages should use the lane surface for dense visualization and this
surface for searchable records or selected-record inspection.

The exact inbound Rivian websocket stream is intentionally separate: signed-in vehicle owners and managers can list retained event metadata at `GET /v1/vehicles/{id}/raw-events` and fetch a single payload at `GET /v1/vehicles/{id}/raw-events/{event_id}`. These session-only routes are excluded from integration-key access and expose their configured retention period in the list response.

All historical endpoints accept a bounded timeframe where applicable. Use UTC
RFC 3339 timestamps and URL-encode query parameters.

Raw Rivian WebSocket event payloads, vehicle membership lists, invitations, and
all configuration routes remain session-only. They are diagnostic or account
management surfaces rather than a stable integration contract.

## Examples

List the scoped vehicle and save its ID:

```powershell
$vehicle = (Invoke-RestMethod -Headers $headers -Uri "$baseUrl/v1/vehicles").vehicles[0]
$vehicleId = $vehicle.id
```

Read a state-of-charge series:

```powershell
$from = '2026-07-01T00:00:00Z'
$to = '2026-07-14T23:59:59Z'
Invoke-RestMethod -Headers $headers `
  -Uri "$baseUrl/v1/battery/soc?vehicle_id=$vehicleId&from=$from&to=$to"
```

Read bounded dashboard metrics:

```powershell
$body = @{
  vehicle_id = $vehicleId
  from = $from
  to = $to
  metrics = @(
    @{ metric = 'odometer_miles'; include_latest = $true; include_series = $false }
    @{ metric = 'avg_efficiency'; include_latest = $true; include_series = $true }
  )
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' `
  -Body $body -Uri "$baseUrl/v1/metrics/batch"
```

## Prometheus is separate

The REST integration API is for structured and historical vehicle data. A
future Prometheus/OpenMetrics exporter should expose only current gauges and
application health, with low-cardinality labels; it should not expose raw
telemetry, trips, locations, or dashboard configuration. See
[`docs/roadmap.md`](./roadmap.md) for that planned exporter work.

## Verification

The optional live contract test uses `VITE_RIVIAMIGO_DEV_API_KEY`:

```powershell
pnpm --filter @riviamigo/web test -- src/test/liveApi.contract.test.ts
```
