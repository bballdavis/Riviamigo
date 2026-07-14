# Riviamigo Metrics Reference

Compiled from Teslamate (open-source, most comprehensive), Tessie, and Rivian Roamer.
Used to ensure full parity with the best-in-class EV trackers.

---

## 1. Battery Health

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| State of Charge (SoC) | % | Time-series | Raw + smoothed |
| Estimated range | mi / km | Time-series | Based on reported DTE |
| Battery capacity (rated) | kWh | Static | From vehicle config |
| Battery capacity (usable) | kWh | Derived | From charge session data |
| Degradation % | % | Derived | Usable/rated × 100 |
| Phantom drain rate | %/hr | Derived | SoC lost while parked/asleep |
| Phantom drain daily total | % | Derived | Aggregated per day |
| Charge limit | % | Time-series | User-set limit |
| Preconditioning active | bool | Time-series | Battery thermal prep |
| HV battery thermal event | enum | Time-series | None/Reduced/Forced |
| 12V battery health | enum | Time-series | Normal/Warning/Critical |
| Cell voltage min/max | V | Optional | Not always exposed by Rivian |

---

## 2. Charging

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Charger type | AC/L2/DCFC | Per session | |
| Charger power (live) | kW | Time-series | Peak and live |
| Energy added | kWh | Per session | |
| SoC start → end | % | Per session | |
| Duration | min | Per session | |
| Charge cost | $ | Per session | Calculated from rate × kWh |
| Charge curve | kW @ SoC% | Time-series | For charge speed visualization |
| Time to full | min | Live | |
| Charge rate (avg) | kW | Per session | energy_added / duration |
| Location (home / away) | bool + name | Per session | Geo-reverse or home radius |
| Sessions per week | count | Aggregate | |
| Energy per week | kWh | Aggregate | |
| Cost per week / month | $ | Aggregate | |
| DC fast charge count | count | Aggregate | Counts DCFC use |
| Charge efficiency | % | Derived | AC-in vs kWh-added (if AC inlet measured) |
| Peak charge speed | kW | Per session | |
| kWh added at home vs away | kWh | Aggregate | Split by location |

---

## 3. Trips / Driving

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Distance | mi | Per trip | |
| Duration | min | Per trip | |
| Start / end SoC | % | Per trip | |
| Energy used | kWh | Per trip | |
| Efficiency | Wh/mi | Per trip | |
| Max speed | mph | Per trip | |
| Avg speed | mph | Per trip | |
| Drive mode | enum | Per trip | Sport / All-Purpose / Conserve / Off-Road |
| Outside temp | °C / °F | Per trip | Snapshot at trip start |
| Elevation gain | ft / m | Per trip | From GPS track |
| Route map (GPS track) | path | Per trip | Lat/lng polyline |
| Speed profile | mph over time | Per trip | For speed-over-elapsed chart |
| Altitude profile | ft over dist | Per trip | Elevation vs distance |
| Signed net power (estimated) | kW over time | Per trip | Derived from bounded SoC changes and median battery capacity when direct power is unavailable; positive = pack discharge, negative = net regeneration |
| Direct traction / regen power | kW over time | Per trip | Nullable upstream fields; used when at least two valid direct samples are present |
| Regen braking % | % of energy | Per trip | regen_kWh / total_kWh |
| Trips per week | count | Aggregate | |
| Miles per week | mi | Aggregate | |
| Efficiency trend | Wh/mi over time | Aggregate | Rolling 7/30-day |
| Efficiency by drive mode | Wh/mi | Aggregate | Grouped |
| Efficiency vs temp | Wh/mi @ temp | Aggregate | Scatter / binned |
| Efficiency vs speed | Wh/mi @ speed | Aggregate | Binned speed buckets |

---

## 4. Live / Real-Time Vehicle Status

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Power state | enum | Live | Sleep / Ready / Go / Drive / Charging |
| Speed | mph | Live | |
| Gear | enum | Live | P / R / N / D |
| Odometer | mi | Live | Cumulative |
| Latitude / Longitude | deg | Live | Current position |
| Altitude | m | Live | |
| Heading | deg | Optional | |
| Is online | bool | Live | |
| Last seen | timestamp | Derived | |
| Cabin temp | °C | Live | |
| Driver set temp | °C | Live | |
| Outside temp | °C | Live | If reported |
| HVAC mode | enum | Optional | Heat / Cool / Auto / Off |
| HVAC running | bool | Optional | |
| Doors locked | bool | Optional | |
| Windows status | enum | Optional | |
| Tire pressure (per wheel) | PSI | Optional | Front-L/R, Rear-L/R |
| Center display version | string | Optional | Software version |

---

## 5. Efficiency & Performance

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Avg efficiency (period) | Wh/mi | Aggregate | Configurable window |
| P10 / P90 efficiency | Wh/mi | Aggregate | Distribution percentiles |
| Efficiency by drive mode | Wh/mi | Aggregate | Grouped bar chart |
| Efficiency vs temperature | Wh/mi | Aggregate | Cold/warm correction insight |
| Avg outside temperature | °C | Trip weather timeline | Time-weighted merged vehicle/Open-Meteo samples; estimated provenance is shown in the UI |
| Efficiency trend (rolling) | Wh/mi | Time-series | 7-day rolling avg |
| Cost per mile | $/mi | Derived | From kWh rate setting |
| Energy cost total (period) | $ | Aggregate | |
| Regen recovered (period) | kWh | Aggregate | |
| Regen as % of consumption | % | Derived | |

---

## 6. Climate & Environment

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Cabin temp history | °C | Time-series | When online |
| Outside temp correlation | °C vs Wh/mi | Derived | Uses the same route-aware trip summary as the timeline and efficiency buckets |
| Preconditioning events | count/duration | Aggregate | |
| Cabin overheat protection | bool | Optional | |

---

## 7. Odometer & Lifetime Stats

| Metric | Unit | Source | Notes |
|--------|------|--------|-------|
| Total lifetime miles | mi | Live odometer | Dashboard should use latest `odometer_miles` first, with trip-distance sum only as a fallback. |
| Total lifetime trips | count | Cumulative | |
| Total lifetime energy used | kWh | Cumulative | |
| Total lifetime charge sessions | count | Cumulative | |
| Total lifetime energy charged | kWh | Cumulative | |
| Total cost (energy) | $ | Cumulative | |
| Avg efficiency (lifetime) | Wh/mi | Derived | |
| Longest trip | mi | Lifetime best | |
| Highest speed | mph | Lifetime best | |

---

## 8. Gaps vs Current Implementation

### Schema additions needed (timeseries.telemetry)
- `heading_deg` FLOAT8
- Raw `outside_temp_c` acquisition remains unavailable from the current Rivian subscription; the normalized column is retained so vehicle readings can supersede estimates if upstream support appears.
- `hvac_active` BOOLEAN
- `regen_power_kw` FLOAT8 (direct upstream field when available)
- `power_kw` FLOAT8 (direct net traction power when available; positive = consuming, negative = regen)
- Signed net power is also derived at read time from SoC deltas when direct fields are absent; it is not written back into telemetry.
- `elevation_gain_m` FLOAT8 (per-event or derived from altitude delta)
- `tire_pressure_fl_psi` FLOAT8
- `tire_pressure_fr_psi` FLOAT8
- `tire_pressure_rl_psi` FLOAT8
- `tire_pressure_rr_psi` FLOAT8

### Trip record additions needed (riviamigo.trips)
- `avg_speed_mph` FLOAT8
- `energy_wh` FLOAT8 (rename from efficiency_wh_per_mile → add absolute)
- `regen_wh` FLOAT8
- `elevation_gain_m` FLOAT8
- `outside_temp_c` FLOAT8 (already in schema ✓)
- `outside_temp_source` TEXT and route-aware `trip_weather_samples` (implemented)

### New API endpoints needed
- `GET /v1/battery/degradation` — capacity trend over time
- `GET /v1/efficiency/vs-temp` — efficiency binned by temperature
- `GET /v1/efficiency/vs-speed` — efficiency binned by avg speed
- `GET /v1/efficiency/trend` — rolling 7/30-day Wh/mi
- `GET /v1/stats/lifetime` — lifetime cumulative stats
- `GET /v1/trips/:id/elevation` — altitude profile for a trip
- `GET /v1/vehicles/:id/raw-data` — raw telemetry coverage and recent samples for acquisition debugging

### New chart components needed
- `DegradationChart` — capacity % over odometer or time
- `EfficiencyVsTempChart` — scatter/binned bar
- `EfficiencyTrendChart` — rolling avg line
- `ElevationProfileChart` — altitude vs distance for a trip
- `ChargingHeatmap` — day-of-week / hour-of-day charge frequency

### UI layout needed
- `MetricTabs` primitive — pill tabs or segmented control, collapses to dropdown at N > 5
- Battery page: tabs for SoC / Range / Phantom Drain / Degradation
- Efficiency page: tabs for By Mode / vs Temp / vs Speed / Trend
- Charging page: tabs for Sessions / Curve / Summary / Heatmap
- Trips page: tabs for List / Map / Stats
