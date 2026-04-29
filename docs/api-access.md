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
$baseUrl = "http://localhost:3000"
Invoke-RestMethod -Headers @{ Authorization = "Bearer $apiKey" } `
  -Uri "$baseUrl/v1/api/catalog"
```

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
