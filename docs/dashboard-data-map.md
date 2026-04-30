# Dashboard data map

This document tracks what the dashboards need, what TeslaMate-style EV logging commonly shows, what Rivian appears to expose, and what Riviamigo currently stores.

Sources:

- Rivian vehicle state reference: https://rivian-api.kaedenb.org/app/vehicle-info/vehicle-state/
- Rivian websocket subscription reference: https://rivian-api.kaedenb.org/app/vehicle-info/subscriptions/
- Rivian vehicle image reference: https://rivian-api.kaedenb.org/app/vehicle-info/vehicle-images/
- TeslaMate car summary reference: https://deepwiki.com/teslamate-org/teslamate/4.3-car-summary-display
- Unofficial Rivian Home Assistant integration: https://github.com/bretterer/home-assistant-rivian

## Dashboard inventory

| Dashboard | Widgets | Primary data source | Current status |
| --- | --- | --- | --- |
| Dashboard | total miles, trips, energy, efficiency, SoC chart, efficiency trend | latest telemetry, trips, charges | Total miles now uses live odometer; efficiency waits for completed trips. |
| Battery | current SoC, estimated range, phantom drain, capacity health, SoC/range/drain/degradation charts | latest telemetry plus battery time-series views | Current SoC/range now use latest vehicle status; capacity falls back to latest usable kWh. |
| Efficiency | avg Wh/mi, best/worst bands, efficiency by mode, trend, temp bins | completed trips | Needs more trip finalization and outside-temp capture before it becomes rich. |
| Charging | energy, cost, sessions, charge mix, weekly energy | charge session detector | Endpoint now returns stable empty states; needs real completed sessions. |
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
| Closures and locks | doors, windows, frunk/liftgate/tailgate, locked/unlocked | door/window/closure fields in `vehicleState` | Documented Rivian fields; not stored yet. |
| Tires and maintenance | TPMS status, 12V health, brake/wiper warnings | `tirePressureStatus*`, `twelveVoltBatteryHealth`, `brakeFluidLow`, `wiperFluidState` | 12V captured; tire status not stored yet. |
| Software | current version, available version, install status/progress | `otaCurrentVersion*`, `otaAvailableVersion*`, `otaStatus`, `otaInstallProgress` | Documented Rivian fields; not stored yet. |
| Media/images | configured vehicle images, wheel image, light/dark variants | `getVehicleImages`, wheel image URL endpoint | Not integrated; should call/cache by config metadata, not scrape blindly. |

## Next acquisition batches

1. Closures and locks: add door/window/frunk/liftgate/tailgate closed and locked fields, then show real lock/open chips.
2. OTA/software: add current/available version and install status fields, then show "up to date" only when data confirms it.
3. Tire status: store Rivian TPMS status/valid fields first; only add numeric PSI if the API exposes confirmed numeric pressure fields.
4. Climate depth: preconditioning, pet mode, defrost, steering wheel heat, and seat heat/vent.
5. Vehicle imagery: persist vehicle image URLs from `getVehicleImages` using vehicle version/config metadata; use generic model art until exact assets are known.

## Verification loop

For each new field family:

1. Add only schema-confirmed fields to the websocket or vehicle-state query.
2. Store raw normalized values in Timescale or a dedicated state table.
3. Add coverage counts to `GET /v1/vehicles/:id/raw-data`.
4. Confirm non-null samples in Settings -> Raw Data.
5. Promote the field into dashboard chips/cards/charts.
