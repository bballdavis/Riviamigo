---
title: Dashboard data map
description: Trace dashboard needs through telemetry, storage, API, and presentation ownership.
slug: /reference/dashboard-data-map/
---

# Dashboard data map

This document tracks what the dashboards need, what TeslaMate-style EV logging commonly shows, what Rivian appears to expose, and what Riviamigo currently stores.

Sources:

- Rivian vehicle state reference: https://rivian-api.kaedenb.org/app/vehicle-info/vehicle-state/
- Rivian websocket subscription reference: https://rivian-api.kaedenb.org/app/vehicle-info/subscriptions/
- Rivian vehicle image reference: https://rivian-api.kaedenb.org/app/vehicle-info/vehicle-images/
- TeslaMate car summary reference: https://deepwiki.com/teslamate-org/teslamate/4.3-car-summary-display
- Unofficial Rivian Home Assistant integration: https://github.com/bretterer/home-assistant-rivian
- Home Assistant Rivian entity definitions: `.codex_tmp/home-assistant-rivian/custom_components/rivian/const.py`
- Home Assistant Rivian image coordinator: `.codex_tmp/home-assistant-rivian/custom_components/rivian/coordinator.py`
- Rivian Python client image query: `.codex_tmp/rivian_python_client_2_0_0/rivian/rivian.py`

## Dashboard inventory

| Dashboard | Widgets | Primary data source | Current status |
| --- | --- | --- | --- |
| Dashboard | total miles, trips, energy, efficiency, SoC chart, efficiency trend | latest telemetry, trips, charges | Total miles now uses live odometer; efficiency waits for completed trips. |
| Battery | current SoC, estimated range, phantom drain, capacity health, SoC/range/drain/degradation charts | latest telemetry plus validated parked periods from the idle-drain route | Phantom Drain rate is duration-weighted from validated parked periods; current SoC/range use latest vehicle status; capacity falls back to latest usable kWh. |
| Efficiency | avg Wh/mi, best/worst bands, efficiency by mode, trend, temp bins, average outside temperature | completed trips plus route-aware trip weather samples | Outside temperature is a time-weighted vehicle/Open-Meteo summary shared with the trip timeline. |
| Charging | energy, cost, sessions, charge mix, daily energy, charging curve trend | charge session detector and charging curve samples | Charging charts use a dedicated daily chart-series endpoint and a session-aware curve-analysis path; daily totals and stacked session composition share the filled charging-bar visual; older curves can fall back to saved Rivian charge points when telemetry history is sparse. |
| Trips | trip list, route map, synchronized detail charts, speed, elevation, signed net power | completed trip detector, persisted route previews, adaptive telemetry samples, SoC/capacity telemetry | Map requests use one bounded route dataset; detail requests use one columnar sample payload and canvas charts. Drive power uses direct fields when available, otherwise a bounded SoC-derived estimate with provenance and coverage metadata. |
| Settings Raw Data | bounded telemetry lanes, searchable normalized records, per-field coverage, selected-record inspection, and owner/manager-only retained inbound events | bucketed Timescale telemetry for dense views, compatibility raw records for detail, plus short-lived Rivian websocket payload retention | Use lanes for history visualization and the normalized record path for search/detail; original payloads are troubleshooting evidence, not a stable dashboard contract. |

## Full-density dashboard time-series rule

Dashboard time-series charts and sparklines return every retained normalized
telemetry, trip, or charge-session point in the selected range. They must not
silently switch to minute/hour/day/week averages or impose a display-point cap.
The typed batch and chart routes remain the only delivery seams; raw-event JSON
is still a troubleshooting contract, not a dashboard data source. Where older
raw history is unavailable, a chart may use the highest-resolution retained
aggregate and must retain its source provenance.

Intentional aggregation remains valid when it is the chart's meaning: charging
and Phantom Drain bars use local days, while drive-mode and temperature charts
use categories/bins. Trip-detail charts retain their 10-second synchronized
telemetry contract.

## TeslaMate parity targets

### Charging chart semantics

- `Energy Charged` (`charging-weekly-energy`) is a daily total-energy bar chart. Each bar is the local calendar date on which the session started and hover shows the day plus total kWh.
- `Daily Charge Sessions` (`charging-sessions-energy`) is a daily stacked bar chart. Each local start-date bar is composed of AC, DC, and Unknown session groups, with legend, grouped hover details including the sum of recorded USD costs per charger type, and optional day selection for the charging table.
- `DC Charging Curve Trend` uses only completed, non-home sessions canonically classified as DC. It shows every telemetry-backed session/SoC point, collapsing only duplicate readings from the same session at the same exact SoC. Evidence points fade from accent orange at lower power to green at higher power. The in-chart trend control can show a smooth local observed regression or a local upper-quartile best-observed regression, or hide that line entirely. Direct Rivian kW is preferred; when unavailable, power is derived from observed SoC change and elapsed time. Saved Rivian curve points with interpolated SoC remain visibly marked as estimated history and never affect either summary.
- Both charts use the shared filled-bar treatment; the stacked chart retains its segmentation because it answers a different question from the daily total chart.

TeslaMate-style dashboards generally cover these data families:

| Family | Example metrics | Rivian candidate fields | Riviamigo status |
| --- | --- | --- | --- |
| Live battery | SoC, rated/estimated range, charge limit, usable capacity | `batteryLevel`, `distanceToEmpty`, `batteryLimit`, `batteryCapacity` | Captured and surfaced. |
| Location and motion | latitude, longitude, speed, altitude, heading, odometer | `gnssLocation`, `gnssSpeed`, `gnssAltitude`, `gnssBearing`, `vehicleMileage` | Captured; odometer converted from meters to miles. |
| Charging | plugged/charging state, charge status, time remaining, sessions, rate | `chargerState`, `chargerStatus`, `timeToEndOfCharge`, live charge endpoints | Basic status captured; session aggregation needs more real data. |
| Drive efficiency | trip distance, Wh/mi, drive mode, elevation, cabin/setpoint temperature, estimated exterior temperature, signed net power | `driveMode`, telemetry deltas, `batteryLevel`, `batteryCapacity`, `cabinClimateInteriorTemperature`, trip points, `trip_weather_samples` | Exterior samples are estimated because Rivian rejects the subscription field; power is direct only when Rivian supplies it, otherwise averaged between SoC updates with explicit provenance. |
| Climate | cabin temp, driver setpoint, preconditioning, pet mode, defrost, seat heat/vent | climate and seat fields in `vehicleState` | Cabin/driver temp captured; advanced climate fields not yet stored. |
| Closures and locks | doors, windows, frunk/liftgate/tailgate, side bins, tonneau, locked/unlocked | HASS `LOCK_STATE_ENTITIES`, `DOOR_STATE_ENTITIES`, `CLOSURE_STATE_ENTITIES` | Door/frunk/liftgate/tailgate basics stored; side bins, tonneau, and windows are next parity gaps. |
| Tires and maintenance | TPMS pressure, TPMS status/validity, 12V health, brake/wiper warnings | `tirePressure*` values are BAR in HASS, plus `tirePressureStatus*` and `tirePressureStatusValid*` | Numeric tire pressure converted to PSI on ingest; status stored; validity still a gap. |
| Software | current version, available version, install status/progress/readiness | `otaCurrentVersion*`, `otaAvailableVersion*`, `otaStatus`, `otaInstallProgress`, `otaInstallReady` | Core versions/status stored; week/year/number/progress/readiness are next parity gaps. |
| Media/images | configured vehicle images, style variants | HASS `VehicleImageCoordinator`; cel style uses vehicle version `3`, photo style uses version `2`, `resolution="@3x"` | Every Rivian-provided variant and overlay is mirrored through the existing account session to persistent local storage. UI consumes only first-party normalized side/overhead/front/rear URLs; model-specific packaged artwork renders immediately while missing blobs repair in the background. |

The authenticated artwork endpoint uses `200` only for a validated local mirror. Missing metadata, missing files, checksum failures, and active repairs return `202` with `x-riviamigo-artwork-state: restoring`, causing the browser to keep the packaged R1S/R1T/R2S fallback visible and poll for the completed first-party asset. Startup repairs enrolled vehicles with bounded concurrency so one slow account does not block every other vehicle.

## Home Assistant reference map

The HASS integration is the current executable reference for entity parity.

| Area | HASS fields / behavior | Riviamigo path |
| --- | --- | --- |
| Tire pressure | `tirePressureFrontLeft`, `tirePressureFrontRight`, `tirePressureRearLeft`, `tirePressureRearRight`; HASS declares unit as BAR. | Convert BAR -> PSI in `apps/api/src/ingestion/parser.rs` before storing in `timeseries.telemetry.tire_*_psi`. |
| Tire status | `tirePressureStatusFrontLeft`, `tirePressureStatusFrontRight`, `tirePressureStatusRearLeft`, `tirePressureStatusRearRight`; validity fields are `tirePressureStatusValid*`. | Status stored in `timeseries.telemetry.tire_*_status`; validity fields still need schema/parser coverage. |
| Charging connected | HASS treats `chargerStatus == "chrgr_sts_not_connected"` as unplugged and `chargerState in ["charging_active", "charging_connecting"]` as charging. | UI maps `chrgr_sts_not_connected` to "Not charging" and avoids showing raw `unknown`. |
| Drive mode | HASS maps `everyday` -> All-Purpose, `distance` -> Conserve, off-road variants to display labels. | UI uses the same display map before falling back to gear. |
| Locks | Aggregate locked state is true only when none of HASS `LOCK_STATE_ENTITIES` are `unlocked`. | Door lock booleans stored now; add side bin, tonneau, frunk/liftgate/tailgate aggregate parity next. |
| Closures | Aggregate closure state checks doors plus frunk/liftgate/side bins/tailgate/tonneau for `open`. | Door/frunk/liftgate/tailgate closure booleans stored now; windows/side bins/tonneau next. |
| Software | HASS update entity compares current/available versions and treats `0.0.0` available as current; `otaStatus` `Idle` is not a user-facing drive/charging state. | UI maps no available version or equal version to "Up to date"; raw OTA fields remain in status/raw data. |
| Images | HASS calls `getVehicleMobileImages` through `get_vehicle_images(extension="png", resolution="@3x", vehicle_version="3")` for cel and version `2` for photo; image entities use `size == "large"`. | Riviamigo now requests both style versions, caches image rows, and normalizes placement/design for UI lookup. |

## Next acquisition batches

1. Closures and locks: add side-bin, tonneau, and window fields from HASS `LOCK_STATE_ENTITIES` / `CLOSURE_STATE_ENTITIES`.
2. OTA/software: add week/year/number/git-hash/progress/readiness fields from HASS update entity.
3. Tire status: add `tirePressureStatusValid*` fields; numeric pressures are confirmed BAR and should remain stored as converted PSI.
4. Climate depth: preconditioning, pet mode, defrost, steering wheel heat, and seat heat/vent.
5. Vehicle imagery: persist vehicle image URLs from `getVehicleImages` using vehicle version/config metadata; use generic model art until exact assets are known.

## Verification loop

For each new field family:

1. Add only schema-confirmed fields to the websocket or vehicle-state query.
2. Store raw normalized values in Timescale or a dedicated state table.
3. Add field coverage to `GET /v1/vehicles/:id/raw-data`.
4. Confirm non-null samples and the normalized field inspector in Settings -> Raw Data.
5. Promote the field into dashboard chips/cards/charts.
