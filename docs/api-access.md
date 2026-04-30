# Riviamigo API Access

Use Settings > API Access to create vehicle-scoped API keys for local troubleshooting and integrations. Keys are only shown once.

## Access levels

- `view`: allows `GET` requests for dashboard, vehicle, battery, trip, charging, stats, and live data. Blocks writes and admin routes.
- `edit`: allows `view` plus non-admin writes to owned resources, such as dashboard create/update/delete.
- `admin`: allows admin routes. Admin keys can only be created by a Riviamigo user with `role = 'admin'`.

Vehicle ownership checks still apply to all levels.

## List the API catalog

PowerShell:

```powershell
$apiKey = "rmigo_REPLACE_ME"
$baseUrl = "http://localhost:3001"
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/api/catalog"
```

For local development, store the real key in `.env.local`:

```dotenv
VITE_RIVIAMIGO_DEV_API_KEY=rmigo_REPLACE_ME
VITE_RIVIAMIGO_API_BASE_URL=http://localhost:3001
```

`.env.local` is gitignored; keep committed docs and `.env.example` placeholders only.

Admin catalog:

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/admin/api/catalog"
```

## Read the frontend vehicle payload

This is the fastest check when Settings shows an online vehicle but missing identifiers or dashboard data.

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/vehicles"
```

Then compare the returned `id`, `rivian_vehicle_id`, `vin`, `model`, and `display_name` with the Settings page.

## Read live status

```powershell
$vehicleId = "LOCAL_VEHICLE_UUID"
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/vehicles/$vehicleId/status"
```

## Read dashboard data endpoints

```powershell
$from = "2026-04-01T00:00:00Z"
$to = "2026-04-29T23:59:59Z"
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/battery/soc?vehicle_id=$vehicleId&from=$from&to=$to"

Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/stats/summary?vehicle_id=$vehicleId"
```

If these return empty arrays while `/v1/vehicles/{id}/status` reports online, inspect the ingestion logs and Timescale rows next.

## Run the live endpoint contract test

The opt-in Vitest contract test uses `VITE_RIVIAMIGO_DEV_API_KEY` and exercises the same endpoints the dashboard needs.

```powershell
pnpm --filter @riviamigo/web test -- src/test/liveApi.contract.test.ts
```

The test verifies `GET /v1/vehicles`, `GET /v1/vehicles/{id}/status`, `GET /v1/stats/summary`, `GET /v1/charging`, `GET /v1/efficiency/summary`, and `GET /v1/vehicles/{id}/raw-data`.

If the key is not present, the test suite skips the live contract instead of failing.

## Inspect raw stored telemetry

Use this when dashboard cards are empty and we need to distinguish "Rivian did not send the field" from "we parsed it but did not store it" or "we stored it but the aggregate endpoint missed it".

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/vehicles/$vehicleId/raw-data?limit=25"
```

The Settings page also has a Raw Data tab with field coverage counts and the latest samples.
