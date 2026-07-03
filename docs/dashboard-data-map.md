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
| Battery | current SoC, estimated range, phantom drain, capacity health, SoC/range/drain/degradation charts | latest telemetry plus battery time-series views | Current SoC/range now use latest vehicle status; capacity falls back to latest usable kWh. |
| Efficiency | avg Wh/mi, best/worst bands, efficiency by mode, trend, temp bins | completed trips | Needs more trip finalization and outside-temp capture before it becomes rich. |
| Charging | energy, cost, sessions, charge mix, daily energy, charging curve trend | charge session detector and charging curve samples | Charging charts now use a dedicated daily chart-series endpoint and a session-aware curve-analysis path; older curves can fall back to saved Rivian charge points when telemetry history is sparse. |
| Trips | trip list, track, speed, elevation | completed trip detector and raw telemetry points | Needs trip detector confidence after longer drives. |
| Settings Raw Data | telemetry field coverage and recent samples | raw Timescale telemetry | Use this to verify ingestion before wiring new dashboard cards. |

## TeslaMate parity targets

TeslaMate-style dashboards generally cover these data families:

| Family | Example metrics | Rivian candidate fields | Riviamigo status |
| --- | --- | --- | --- |
| Live battery | SoC, rated/estimated range, charge limit, usable capacity | `batteryLevel`, `distanceToEmpty`, `batteryLimit`, `batteryCapacity` | Captured and surfaced. |
| Location and motion | latitude, longitude, speed, altitude, heading, odometer | `gnssLocation`, `gnssSpeed`, `gnssAltitude`, `gnssBearing`, `vehicleMileage` | Captured; odometer converted from meters to miles. |
| Charging | plugged/charging state, charge status, time remaining, sessions, rate | `chargerState`, `chargerStatus`, `timeToEndOfCharge`, live charge endpoints | Basic status captured; session aggregation needs more real data. |
| Drive efficiency | trip distance, Wh/mi, drive mode, elevation, temperature | `driveMode`, telemetry deltas, `cabinClimateInteriorTemperature`, trip points | Trip-based; currently sparse. |
| Climate | cabin temp, driver setpoint, preconditioning, pet mode, defrost, seat heat/vent | climate and seat fields in `vehicleState` | Cabin/driver temp captured; advanced climate fields not yet stored. |
| Closures and locks | doors, windows, frunk/liftgate/tailgate, side bins, tonneau, locked/unlocked | HASS `LOCK_STATE_ENTITIES`, `DOOR_STATE_ENTITIES`, `CLOSURE_STATE_ENTITIES` | Door/frunk/liftgate/tailgate basics stored; side bins, tonneau, and windows are next parity gaps. |
| Tires and maintenance | TPMS pressure, TPMS status/validity, 12V health, brake/wiper warnings | `tirePressure*` values are BAR in HASS, plus `tirePressureStatus*` and `tirePressureStatusValid*` | Numeric tire pressure converted to PSI on ingest; status stored; validity still a gap. |
| Software | current version, available version, install status/progress/readiness | `otaCurrentVersion*`, `otaAvailableVersion*`, `otaStatus`, `otaInstallProgress`, `otaInstallReady` | Core versions/status stored; week/year/number/progress/readiness are next parity gaps. |
| Media/images | configured vehicle images, style variants | HASS `VehicleImageCoordinator`; cel style uses vehicle version `3`, photo style uses version `2`, `resolution="@3x"` | Cached on add/backfill through the same GraphQL shape; UI consumes side/overhead/front/rear normalized placements. |

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
3. Add coverage counts to `GET /v1/vehicles/:id/raw-data`.
4. Confirm non-null samples in Settings -> Raw Data.
5. Promote the field into dashboard chips/cards/charts.
