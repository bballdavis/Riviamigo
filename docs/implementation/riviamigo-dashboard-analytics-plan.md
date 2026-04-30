# Riviamigo Dashboard & Analytics Implementation Plan

> Status: Planning. Authoritative reference for follow-on coding agents.
> Primary reference implementation: [TeslaMate](https://github.com/adriankumpf/teslamate).
> Riviamigo target: Rivian R1S/R1T/R2/R3 owners running a self-hosted analytics stack.
>
> Conventions used in this document:
> - **[Confirmed]** = read directly from TeslaMate source or Riviamigo source.
> - **[Assumption]** = inferred or pending verification by Riviamigo coding agent.
> - **[Rivian-gap]** = Tesla feature with no direct Rivian equivalent; requires adaptation.

---

## 1. Executive Summary

### What TeslaMate does well
- **A small, opinionated relational schema** (`cars`, `positions`, `drives`, `charging_processes`, `charges`, `states`, `geofences`, `addresses`, `updates`) that supports every dashboard via on-read SQL — no ETL pipeline, no warehouse, just well-shaped tables and Grafana queries.
- **Calculation honesty**: charging energy is integrated from instantaneous power × Δt (`charge_energy_used`) and compared against the manufacturer-reported `charge_energy_added`; the *larger* of the two is used as the cost denominator. Efficiency is a per-car coefficient continuously recalibrated from charge sessions.
- **Dashboards designed around questions**, not data: *"What did this drive cost me?"*, *"Is the car draining when parked?"*, *"How much have I spent on charging this month?"*
- **Unit-of-measure abstraction in SQL** (`convert_km`, `convert_celsius`, `convert_pressure`) so every dashboard is i18n/imperial-friendly without schema duplication.
- **`mode() WITHIN GROUP`, window functions, and CTE-driven UNIONs** instead of materialized aggregates — keeping the data model simple at the cost of query complexity.

### What Riviamigo should emulate
- The **session-aggregation pattern**: raw samples → per-session row written when the session closes, with start/end position/SOC/range/odometer captured atomically.
- The **state machine for transitions** (`drive`, `charge`, `online/asleep/offline`) backed by an explicit `states`-style table.
- **Geofences with cost profiles** (per-kWh, per-minute, free, session fee) bound to addresses.
- **Vampire/idle drain as a SQL view** over the gap between drives/charges, filtered for moved-distance and reduced-range conditions.
- **Charging cost classification by session type** (AC vs DC, home vs public).

### What must be adapted for Rivian
- **Single SOC and single range** — drop TeslaMate's `usable_battery_level` and `ideal/rated/est` triplet. Rivian gives `batteryLevel` (%) and `distanceToEmpty` (mi/km).
- **No phase-based AC/DC inference** — Rivian charging telemetry exposes charger type and rate directly; classify by `chargerState` + `chargerStatus` + power magnitude.
- **No "asleep" state** as Tesla defines it — Riviamigo already models `power_state ∈ {sleep, ready, go, drive, charging}` plus `is_online`. Map TeslaMate's `states.status` onto these.
- **Push/WebSocket-first ingestion** — TeslaMate's whole sleep-prevention/`suspend_after_idle_min` mechanism is unnecessary; the Rivian GraphQL subscription pushes deltas.
- **No `eid`/`vid`** — Riviamigo uses `vehicles.id` (UUID) plus `rivian_vehicle_id` and `vin`.
- **Network branding**: Tesla Supercharger → Rivian Adventure Network (RAN), Electrify America, EVgo, ChargePoint. Cost-detection heuristics need a provider taxonomy, not `ILIKE '%supercharger%'`.

### What to prioritize first
Riviamigo already has a *strong* foundation — TimescaleDB hypertable, trip and charge detectors, materialized views for phantom drain and efficiency-vs-temp, and a dynamic-dashboard framework being built. The highest-leverage gaps are:

1. **Geofence + address tables** (Phase 3) — unlock location-based charging cost, home/public classification, "visited" map, and per-location drive/charge rollups. This is the single biggest missing concept vs TeslaMate.
2. **Cost profiles** (Phase 8) — link geofences to per-kWh/per-minute pricing so `charge_sessions.cost_usd` is computed correctly instead of being null or static.
3. **Drive-points materialization** (Phase 4) — link `telemetry` rows to a `drive_id` so per-trip route, speed profile, and elevation profile queries are fast and don't require time-window scans.
4. **Vampire/idle drain SQL view** (Phase 9) — TeslaMate-style gap query, filtered for "reduced range" conditions Rivian-specifically.
5. **Daily/monthly rollup tables** (`odometer_daily`, `efficiency_daily`, `charging_daily`) for the Statistics dashboard.
6. **A real Overview dashboard** that combines live status + today's drive + last charge + recent efficiency in one card grid.

### Final user value
A Rivian owner opens Riviamigo and answers, in under one click each:
- *Where is my truck right now and what's it doing?*
- *How much did this week's driving cost me?*
- *What's my real-world efficiency in cold weather vs summer?*
- *Is my battery degrading?*
- *How much SOC did I lose sitting at the airport for 4 days?*
- *What's my home vs public charging split?*
- *Which trips were the longest, fastest, most efficient?*

---

## 2. TeslaMate Research Summary

Repository inspected: `https://github.com/adriankumpf/teslamate` (master branch).

### Repository areas reviewed

| Path | Purpose | Why it matters to Riviamigo |
|---|---|---|
| `priv/repo/migrations/` (90 files) | Ecto migrations — canonical schema | Source of truth for table shapes; we mirror many concepts |
| `lib/teslamate/log.ex` (~21 KB) | `start_drive`, `close_drive`, `start_charging_process`, `complete_charging_process`, `recalculate_efficiency` | Reference implementation of session aggregation logic. Riviamigo's `ingestion/trip_detector.rs` and `charge_detector.rs` play this role |
| `lib/teslamate/log/{car,position,drive,charging_process,charge,state,update}.ex` | Ecto schemas | Field-by-field schema reference |
| `lib/teslamate/locations.ex`, `lib/teslamate/locations/` | Geofence + address logic | Riviamigo has no geofence tables yet — adopt this pattern |
| `lib/teslamate/vehicles/vehicle.ex` | GenStateMachine for poll/subscribe + drive/charge/sleep transitions | Reference for state-transition triggers |
| `lib/teslamate/custom_expressions.ex` | Ecto macros: `c_if`, `duration_min`, `distance`, `within_geofence?`, `nullif`, `round` | Pattern for SQL helpers; Riviamigo can implement equivalents as Postgres functions |
| `grafana/dashboards/*.json` (19 files) | All Grafana dashboards as JSON | Source for dashboard intent, panels, queries |
| `grafana/dashboards/internal/`, `reports/` | Drilldowns and reports | Lower priority; reference only |
| `lib/teslamate/repair.ex` | Backfill / fix incomplete sessions | Reference for our backfill plan in Section 15 |
| `lib/teslamate/terrain.ex` | Elevation enrichment via external API | Riviamigo has `altitude_m` from Rivian GNSS — no enrichment needed |
| `lib/teslamate_web/` | Phoenix LiveView UI | Not directly relevant — Riviamigo uses React + custom dashboards instead of Grafana |

### Reuse posture
- **Reuse conceptually**: schema shape (drives, charging_processes ≈ charge_sessions, charges ≈ charging_samples, states, geofences, addresses, updates), session-detection state machines, idle-drain SQL pattern, cost-profile model, statistics dashboard structure.
- **Do NOT reuse**: `usable_battery_level` vs `battery_level`, `ideal/rated/est` range triplet, `charger_phases` AC/DC inference, `suspend_min`/`req_no_shift_state_reading` sleep-prevention machinery, `eid`/`vid` identifiers, Tesla brand string heuristics, Grafana JSON dashboards (Riviamigo uses native React).
- **Reimplement, don't port**: SQL helper functions (`convert_km`, etc.) — Riviamigo already does unit conversion in TypeScript hooks; keep that pattern.

### Direct file references (cited where used in this document)

```
priv/repo/migrations/20190330150000_create_car.exs
priv/repo/migrations/20190330160000_create_trips.exs           (later renamed → drives)
priv/repo/migrations/20190330170000_create_positions.exs
priv/repo/migrations/20190330180000_create_states.exs
priv/repo/migrations/20190330190000_create_charging_processes.exs
priv/repo/migrations/20190330200000_create_charges.exs
priv/repo/migrations/20190408203117_create_updates.exs
priv/repo/migrations/20190415130006_create_addresses.exs
priv/repo/migrations/20190729142656_add_conversion_functions.exs
priv/repo/migrations/20190810151901_create_geofences.exs
priv/repo/migrations/20191003130650_add_start_and_end_position_to_drives.exs
priv/repo/migrations/20191017003836_add_est_total_charge_energy.exs
priv/repo/migrations/20191026185642_calculate_charge_energy_used.exs
priv/repo/migrations/20200203180529_location_based_charge_cost.exs
priv/repo/migrations/20200528163852_cost_by_minute.exs
lib/teslamate/log.ex
lib/teslamate/locations.ex
lib/teslamate/vehicles/vehicle.ex
lib/teslamate/custom_expressions.ex
grafana/dashboards/{overview,drives,drive-stats,charges,charging-stats,efficiency,
                   vampire-drain,visited,mileage,projected-range,statistics,
                   states,trip,updates,battery-health}.json
```

---

## 3. TeslaMate Dashboard Inventory

All 19 dashboards live in `grafana/dashboards/`. Below: the 13 most relevant.

### 3.1 `overview.json` — Live status
- **Purpose**: Single-page "what's the car doing right now" view.
- **Panels**: Battery Level gauge, Charging Voltage/Power gauges, Charge Level (24h time series), Ø Consumption (net/gross stats), Total Distance, Range, Firmware, Odometer, Charging Details time series (power/current/voltage/heater), Inside / Outside / Driver temperature gauges, States timeline strip.
- **Tables hit**: `positions`, `charges`, `charging_processes`, `drives`, `states`, `updates`, `cars`, `car_settings`.
- **Riviamigo equivalent**: `Overview Dashboard` (Section 10.1). Already partially built — extend with a States timeline strip and a "today" rollup.

### 3.2 `drives.json` — Drive list
- **Purpose**: Listing of drives in selected window with per-drive metrics.
- **Panels**: Long table with start/end timestamp, distance, duration, max speed, range delta, temperature delta, efficiency.
- **Key SQL** (representative pattern, simplified):
  ```sql
  SELECT id, start_date, end_date, distance, duration_min, speed_max,
         (start_rated_range_km - end_rated_range_km) * cars.efficiency AS energy_kwh,
         outside_temp_avg
  FROM drives JOIN cars ON cars.id = drives.car_id
  WHERE drives.car_id = $car_id AND $__timeFilter(start_date)
  ORDER BY start_date DESC;
  ```
- **Riviamigo equivalent**: `Drives Dashboard` (10.2). Riviamigo already has a `trips` table with most fields; needs a route-on-hover preview.

### 3.3 `drive-stats.json` — Drive aggregate KPIs
- **Purpose**: "How much have I driven recently?" — count, median distance, max speed, monthly extrapolation, top destinations.
- **Notable queries**:
  ```sql
  SELECT count(*) FROM drives WHERE car_id=$car_id AND $__timeFilter(start_date);
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) FROM drives ...;
  SELECT max(speed_max) FROM drives ...;
  -- Top destinations
  SELECT addresses.display_name AS destination, count(*) AS visited
    FROM drives JOIN addresses ON drives.end_address_id = addresses.id
   WHERE car_id=$car_id GROUP BY 1 ORDER BY visited DESC LIMIT 10;
  ```
- **Required for Riviamigo**: `addresses` table, `end_address_id` FK on `trips`. **[Gap]** — both missing.

### 3.4 `charges.json` — Charging session list
- **Purpose**: Per-session listing with derived efficiency and cost-per-kWh.
- **Notable derived columns**:
  ```sql
  charge_energy_added / GREATEST(charge_energy_used, charge_energy_added)
    AS charging_efficiency,
  cost / NULLIF(GREATEST(charge_energy_added, charge_energy_used), 0)
    AS cost_per_kwh
  ```
- **Riviamigo equivalent**: `Charging Dashboard` (10.3). `charge_sessions` table exists. Gaps: `charge_energy_used` (integrated), `charge_energy_added` (reported) aren't separately tracked — Riviamigo only stores `kwh_added`/`energy_added_wh`. Need both for honest efficiency.

### 3.5 `charging-stats.json` — Aggregate charging
- **Purpose**: Total cost, cost/kWh, supercharger split, AC vs DC split.
- **Pattern (DC-only Cost/kWh CTE)**:
  ```sql
  WITH data AS (
    SELECT cp.id, cp.cost, cp.charge_energy_added, cp.charge_energy_used,
      CASE WHEN NULLIF(mode() WITHIN GROUP (ORDER BY charger_phases),0) IS NULL
           THEN 'DC' ELSE 'AC' END AS current
    FROM charging_processes cp
    RIGHT JOIN charges ON cp.id = charges.charging_process_id
    WHERE cp.car_id=$car_id AND duration_min>=$min_duration
      AND $__timeFilter(end_date)
    GROUP BY 1)
  SELECT sum(cost)/sum(greatest(charge_energy_added,charge_energy_used))
   FROM data WHERE current = 'DC';
  ```
- **Adapt for Riviamigo**: Replace `mode() WITHIN GROUP (charger_phases)` with `charge_sessions.charger_type` (already classified `'ac'|'dc'|'dcfc'` at write time).

### 3.6 `efficiency.json` — Wh/km over time
- **Purpose**: Net (drive-only) and gross (drive + idle) efficiency trend.
- **Net Wh/km**:
  ```sql
  SELECT sum((start_rated_range_km - end_rated_range_km) * cars.efficiency)
         / convert_km(sum(distance)::numeric, '$length_unit') * 1000
         AS "consumption_wh_per_km"
  FROM drives JOIN cars ON cars.id = drives.car_id ...
  ```
- **Riviamigo equivalent**: `Efficiency Dashboard` (10.4). Riviamigo already has `efficiency_trend_7d` and `efficiency_vs_temp` views — extend with **net vs gross** distinction and per-drive-mode breakdown.

### 3.7 `vampire-drain.json` — Idle drain
- **Purpose**: Range-loss-per-hour while parked.
- **Pattern**: UNION of `drives` end-events and `charging_processes` end-events into a single timeline; for each consecutive pair, compute the gap; filter to `distance_moved < 1km AND duration > $min_idle`; compute `(start_range - end_range) / (duration_h)`.
- **Riviamigo state**: `phantom_drain_periods` and `phantom_drain_daily` views already exist (Section 6). They use telemetry-derived parked windows rather than the gap-between-events pattern. Both approaches work; document the trade-off in Section 11.

### 3.8 `visited.json` — Trail map
- **Purpose**: Heatmap/trail of every minute-bucketed GPS sample.
- **Query**:
  ```sql
  SELECT date_trunc('minute', timezone('UTC',date),'$__timezone') AS time,
         avg(latitude) AS latitude, avg(longitude) AS longitude
    FROM positions
   WHERE car_id=$car_id AND $__timeFilter(date)
     AND ideal_battery_range_km IS NOT NULL
   GROUP BY 1 ORDER BY 1;
  ```
- **Riviamigo equivalent**: `Location Dashboard` (10.7). Need a map component over `telemetry` (`latitude`,`longitude`) with TimescaleDB time-bucket aggregation.

### 3.9 `mileage.json` — Odometer over time
- **Pattern**:
  ```sql
  WITH o AS (
    SELECT start_date AS time, start_km AS odometer FROM drives
    UNION ALL
    SELECT end_date,   end_km   AS odometer FROM drives)
  SELECT time, convert_km(odometer::numeric,'$length_unit') AS mileage
    FROM o WHERE car_id=$car_id ORDER BY 1;
  ```
- **Riviamigo equivalent**: surface in Battery & Range / Efficiency dashboards. Use `trips.start_*` / `trips.end_*` (Riviamigo doesn't yet store start/end odometer per trip — see Section 7 gap).

### 3.10 `projected-range.json`
- **Pattern**:
  ```sql
  (sum(rated_battery_range_km)
   / NULLIF(sum(coalesce(usable_battery_level,battery_level)),0)
   * 100)::numeric AS projected_full_range_km
  ```
- **Riviamigo adaptation**: `distance_to_empty_mi / (battery_level/100) ≈ 100% range`. Drop the `coalesce(usable,...)` — Rivian has only one SOC.

### 3.11 `statistics.json` — Per-period rollup table
- **Purpose**: One row per month/week showing drive count, hours, miles, kWh, cost, efficiency.
- **Riviamigo equivalent**: rollup `*_daily` tables (Section 8) → `Statistics Dashboard` (could be a Cost-dashboard tab).

### 3.12 `states.json` — State timeline
- **Purpose**: Stacked timeline showing driving (1) / charging (2) / offline (3) / asleep (4) / online (5) / updating (6).
- **Pattern**: UNION of `drives`, `charging_processes`, `states`, `updates`, each row mapped to a numeric code with start/end.
- **Riviamigo adaptation**: Use `power_state` from `telemetry` + `trips`/`charge_sessions` rows. **[Gap]** — no `states` table; we can derive state windows from telemetry transitions or add a `vehicle_state_periods` table (Section 8).

### 3.13 `battery-health.json` — Degradation
- **Pattern**:
  ```sql
  SELECT AVG(Capacity) FROM (
    SELECT c.rated_battery_range_km * cars.efficiency / c.usable_battery_level
           AS Capacity
    FROM charging_processes cp
    JOIN charges c ON c.charging_process_id = cp.id
    ORDER BY cp.end_date DESC LIMIT 100) AS lastCharges;
  ```
- **Riviamigo state**: `battery_capacity_snapshots` table already exists. Extend a degradation view that computes capacity from end-of-charge `battery_capacity_wh / (battery_level/100)`.

### 3.14 Other dashboards (lower priority)
- `charge-level.json` — SOC over time (already covered by Riviamigo `SocAreaChart`).
- `database-info.json` — DB stats (skip; not user-facing).
- `locations.json` — geofence editor (covered by 10.7 management UI).
- `timeline.json`, `trip.json` — single-trip drilldown (covered by 10.2 detail page).
- `updates.json` — firmware history (covered by 10.9 Vehicle Health).

---

## 4. TeslaMate Data Model Analysis

### 4.1 `cars`
- **Purpose**: One row per vehicle.
- **Important columns**: `id smallint PK`, `eid bigint UNIQUE`, `vid bigint UNIQUE`, `vin text UNIQUE`, `name`, `model`, `trim_badging`, `marketing_name`, `efficiency float` (per-car Wh/km coefficient, recalibrated), `version` (firmware), `exterior_color`, `wheel_type`, `settings_id FK`, `display_priority`.
- **Used by dashboards**: every dashboard joins on `cars.efficiency` to compute kWh from range delta.
- **Riviamigo mapping**: `vehicles` table — already exists with `id UUID PK`, `vin`, `model`, `trim`, `name`, `battery_capacity_wh`. **Missing**: `efficiency` coefficient (per-vehicle), `display_priority` for multi-vehicle ordering, `firmware_version` (currently in telemetry but not denormalized).

### 4.2 `positions`
- **Purpose**: High-cardinality telemetry stream. One row per Tesla API/stream sample.
- **Important columns**: `car_id`, `drive_id` (nullable; populated when sample belongs to a drive), `date`, `latitude`, `longitude`, `elevation`, `speed`, `power`, `odometer`, `ideal_battery_range_km`, `rated_battery_range_km`, `est_battery_range_km`, `battery_level`, `usable_battery_level`, `outside_temp`, `inside_temp`, `is_climate_on`, `tpms_pressure_*`, `battery_heater*`.
- **Spatial index**: GIST on `ll_to_earth(lat, lon)`.
- **Created**: by `Vehicles.Vehicle` GenStateMachine on each poll/stream tick.
- **Used by**: drive aggregate, charging-process linkage (charging_processes.position_id), visited map, projected-range.
- **Riviamigo mapping**: `timeseries.telemetry` hypertable — already covers all fields except `drive_id` linkage. **Critical gap**: no `drive_id`/`charge_session_id` denormalized onto telemetry rows. This is the single biggest missing concept.

### 4.3 `drives`
- **Important columns**: `car_id`, `start_date`, `end_date`, `distance`, `duration_min`, `start_km`/`end_km` (odometer), `start_*_range_km`/`end_*_range_km`, `outside_temp_avg`, `inside_temp_avg`, `speed_max`, `power_max`, `power_min`, `ascent`, `descent`, `start_position_id`/`end_position_id`, `start_address_id`/`end_address_id`, `start_geofence_id`/`end_geofence_id`.
- **Created**: by `TeslaMate.Log.start_drive/1` on shift→D and closed by `close_drive/2` on shift→P.
- **Used by**: drives, drive-stats, efficiency, mileage, statistics, states.
- **Riviamigo mapping**: `riviamigo.trips` — has most fields. **Gaps**: `start_km`/`end_km` (odometer at boundaries — currently only `distance_miles`), `start_position_id`/`end_position_id` (FK back to first/last telemetry row), `start_address_id`/`end_address_id`, `start_geofence_id`/`end_geofence_id`, `power_max`/`power_min`, `ascent`/`descent` (but Rivian gives `altitude_m`, so derivable).

### 4.4 `charging_processes`
- **Important columns**: `car_id`, `position_id` (where charged), `address_id`, `geofence_id`, `start_date`, `end_date`, `charge_energy_added` (manufacturer-reported, kWh), `charge_energy_used` (integrated, kWh), `start/end_ideal_range_km`, `start/end_rated_range_km`, `start/end_battery_level`, `duration_min`, `outside_temp_avg`, `cost`.
- **Created**: by `start_charging_process` on `charging_state ∈ {Starting,Charging}`, closed by `complete_charging_process`.
- **Riviamigo mapping**: `riviamigo.charge_sessions` — has most fields. **Gaps**: separate `energy_added_wh` (reported) vs `energy_used_wh` (integrated) — currently Riviamigo only has `energy_added_wh`; `geofence_id` FK; `address_id` FK.

### 4.5 `charges`
- **Purpose**: Per-sample telemetry during charging (analog of `positions` but during a charge session).
- **Important columns**: `charging_process_id FK`, `date`, `charge_energy_added`, `charger_actual_current`, `charger_phases`, `charger_pilot_current`, `charger_power`, `charger_voltage`, `conn_charge_cable`, `fast_charger_present/brand/type`, `ideal/rated_battery_range_km`, `battery_level`, `usable_battery_level`, `outside_temp`, `battery_heater*`, `not_enough_power_to_heat`.
- **Used by**: charge curve, AC/DC classification, charging efficiency integration.
- **Riviamigo gap**: **no per-charge-sample table**. Charge samples land in `telemetry` instead, but without explicit `charge_session_id` linkage. Need either (a) `charging_samples` denormalized table or (b) a `charge_session_id` column on `telemetry`. Recommend (b) — no duplication.

### 4.6 `states`
- **Purpose**: Coarse-grained vehicle status periods.
- **Schema**: `id, car_id, state ENUM('online','offline','asleep'), start_date, end_date`. Open period has `end_date IS NULL`.
- **Riviamigo gap**: no equivalent. Currently `vehicle_runtime_state` is a singleton snapshot, not a history. Add `vehicle_state_periods` (or derive in a view from `telemetry.power_state` runs).

### 4.7 `geofences`
- **Important columns**: `name`, `latitude`, `longitude`, `radius` (meters, default 25), `address_id FK UNIQUE`, `cost_per_unit numeric(8,4)`, `billing_type ENUM('per_kwh','per_minute')`, `session_fee`, `sleep_mode_blacklist`, `sleep_mode_whitelist`.
- **Riviamigo gap**: **no geofence table at all**. The `vehicles.home_latitude`/`home_longitude` is a single-point home flag — not a true geofence.

### 4.8 `addresses`
- **Purpose**: OSM Nominatim cache.
- **Important columns**: `display_name`, `osm_id`, `latitude`, `longitude`, `name`, `house_number`, `road`, `neighbourhood`, `city`, `state`, `country`, `raw jsonb`.
- **Riviamigo gap**: no equivalent. For privacy in a self-hosted local-first app, geocoding is *optional*; consider lazy on-demand only.

### 4.9 `updates`
- **Schema**: `car_id, start_date, end_date, version`.
- **Riviamigo gap**: no equivalent table. Riviamigo captures `ota_current_version`/`ota_status` per telemetry sample; need a periods table written when `ota_current_version` changes.

### 4.10 `car_settings`
- **Purpose**: Per-car operational settings (sleep prevention, free supercharging flag).
- **Riviamigo equivalent**: not directly applicable (no sleep-prevention needed). Free-charging flag and any per-car analytics overrides can live in `vehicles` or a new `vehicle_settings` table.

### 4.11 ER summary (TeslaMate → Riviamigo target)
```
cars (1)──< positions ──> drives          [drives.start_position_id, end_position_id]
                          drives ──> addresses, geofences  [start/end FKs]
cars (1)──< charging_processes ──> charges
                          charging_processes ──> addresses, geofences, positions
cars (1)──< states
cars (1)──< updates
geofences (1)──< addresses (UNIQUE)
```

---

## 5. TeslaMate Calculation Analysis

For each calculation: **name | location | inputs | formula | unit | adaptation**.

### 5.1 Drive distance
- **Where**: `Log.close_drive/2` (`lib/teslamate/log.ex`)
- **Formula**: `max(positions.odometer) - min(positions.odometer)` over `drive_id`
- **Unit**: km (stored), converted at read time
- **Riviamigo**: same — but Rivian's `vehicleMileage` is meters; already converted to miles in `parser.rs`. Use `max(odometer_miles)-min(odometer_miles)` over the trip window. *Currently* Riviamigo computes `distance_miles` in `trip_detector.rs` — verify it uses odometer delta (correct) rather than integrated speed (drift-prone).

### 5.2 Drive duration
- **Formula**: `extract(epoch from (max(date)-min(date)))/60` over `drive_id`
- **Unit**: minutes
- **Edge case**: GPS gaps → use first/last sample, not poll count
- **Riviamigo**: store as `duration_seconds INT` (already done).

### 5.3 Average / max speed
- **Where**: `Log.close_drive/2` for max; avg derived in dashboards as `distance / duration`
- **Riviamigo**: `max_speed_mph`, `avg_speed_mph` already on `trips` (migration 0002). Verify avg is computed as `distance_miles / (duration_seconds/3600)`, not `avg(speed_mph)` — the latter biases low when stopped at lights.

### 5.4 Elevation gain/loss
- **Formula**: sum of positive (resp. negative) consecutive `elevation` deltas; capped at int16 max (±32767 m)
- **Pseudocode** (Postgres):
  ```sql
  WITH e AS (
    SELECT elevation - LAG(elevation) OVER (ORDER BY date) AS d
    FROM positions WHERE drive_id=$drive_id)
  SELECT SUM(CASE WHEN d>0 THEN d END) AS ascent,
         SUM(CASE WHEN d<0 THEN -d END) AS descent
   FROM e;
  ```
- **Riviamigo**: already has `elevation_gain_m` on `trips`; add `descent` similarly. Source field is `altitude_m` in `telemetry`.

### 5.5 Consumed energy (drive)
- **Formula**: `(start_rated_range_km - end_rated_range_km) * cars.efficiency`
- **Unit**: kWh
- **Assumption**: range is linearly proportional to kWh; `cars.efficiency` (Wh/km) is roughly constant
- **[Rivian-gap]**: Rivian's range is highly non-linear in temp/drive-mode/wheel size. Recommend a **3-strategy ensemble** (Section 11):
  1. Direct API (Rivian does *not* expose energy used per drive — confirmed [Assumption])
  2. **SOC delta × pack capacity**: `(soc_start - soc_end)/100 * battery_capacity_wh / 1000`
  3. **Range delta × per-vehicle efficiency**: `(range_start - range_end) * efficiency_wh_per_mile / 1000`
  4. **Distance × historical efficiency**: `distance_miles * lookup_efficiency(drive_mode, outside_temp)`
- **Recommendation**: Rank #2 first (most physically grounded), fall back to #3 if SOC delta < 1%, fall back to #4 if both unavailable. Store the chosen strategy.

### 5.6 Efficiency (Wh/mi)
- **Formula** (per-trip): `energy_kwh * 1000 / distance_miles`
- **Formula** (rolling): see `efficiency.json` net query
- **Riviamigo**: already on `trips.efficiency_wh_per_mile`. Add a denormalized `efficiency_wh_per_mi` rolled into `efficiency_daily` (Section 8).

### 5.7 Charging energy added
- **Formula**: `coalesce(nullif(max(charge_energy_added) - min(charge_energy_added), 0), max(charge_energy_added))`
- **Unit**: kWh; **assumption**: the column is monotonic per session
- **Riviamigo**: write when charging detector closes session.

### 5.8 Charging energy used (integrated)
- **Where**: SQL function `calculate_energy_used()` installed in migration `20191026185642_calculate_charge_energy_used`
- **Formula**:
  ```sql
  CASE WHEN charger_phases IS NULL
       THEN charger_power
       ELSE charger_actual_current * charger_voltage * charger_phases / 1000.0
  END
  * EXTRACT(epoch FROM (date - LAG(date) OVER (ORDER BY date))) / 3600
  ```
- **Sums to kWh delivered at the meter.**
- **[Rivian-gap]**: Rivian doesn't expose per-phase current/voltage. Adapt as:
  ```
  energy_used_kwh ≈ Σ (power_kw_at_t * Δt_hours)
  ```
  using the `telemetry.power_kw` field during `charger_state='Charging'`. Power is *negative when consuming from grid* in Rivian convention [Assumption — verify in `parser.rs`].

### 5.9 Charging duration
- **Formula**: `(end_date - start_date)` in minutes
- **Riviamigo**: `duration_minutes` already on `charge_sessions`.

### 5.10 Charging power (avg, max)
- **Formula** (max, from `charges`): `max(charger_power)` over session
- **Riviamigo**: `max_charge_rate_kw` on `charge_sessions`. Add `avg_charge_rate_kw` for cost-of-public-charging analytics.

### 5.11 Charging speed
- **Formula**: `range_added / duration` (mi/h)
- **Useful in DCFC dashboards.**

### 5.12 Charging efficiency
- **Formula**: `charge_energy_added / GREATEST(charge_energy_used, charge_energy_added)`
- **Interpretation**: how much of the meter-energy ended up in the pack (always ≤ 1)
- **Riviamigo**: requires both reported and integrated values (Section 5.7 + 5.8).

### 5.13 Cost per charge
- **Where**: `Log.put_cost/2` in `lib/teslamate/log.ex`
- **Formula**:
  ```
  if free_charging:           cost = 0
  if billing_type=per_kwh:    cost = cost_per_unit * GREATEST(added, used) + session_fee
  if billing_type=per_minute: cost = cost_per_unit * duration_min       + session_fee
  ```
- **Riviamigo gap**: `cost_profiles` table doesn't exist yet. Add per Section 8.

### 5.14 Cost per mile
- **Formula**: `total_cost / total_distance` over period
- **Riviamigo**: derive in API or rollup table.

### 5.15 Vampire / idle drain
- **Where**: `vampire-drain.json` (pure SQL)
- **Formula**: `(start_range - end_range) / (duration_seconds/3600)` over idle gaps where `distance_moved < 1km AND duration > $min_idle`
- **Filter**: exclude periods with reduced range (preconditioning, firmware update, cold soak)
- **Riviamigo current state**: `phantom_drain_periods` view computes this directly from `telemetry` runs of `power_state ∈ {sleep, ready}`. Different approach, similar result. Keep current — it's cleaner with a push-based ingestion.
- **Add**: filter to exclude periods where `outside_temp_c < -5°C` or `hvac_active=true` (Rivian preconditioning).

### 5.16 Sleep / wake periods
- **TeslaMate**: explicit `states` table.
- **Riviamigo**: derive from `power_state` transitions in telemetry, materialized into `vehicle_state_periods` (Section 8).

### 5.17 Location aggregation (visited)
- **Pattern**: time-bucket points, group by minute, render heatmap
- **Riviamigo**: TimescaleDB `time_bucket('1 minute', ts)` over `telemetry`.

### 5.18 Home / work / geofence grouping
- **Pattern**: `Locations.find_geofence(point)` — `WHERE within_geofence?(point, geofence)` ordered by distance
- **Riviamigo gap**: no geofence machinery yet. Implement with `cube`/`earthdistance` extensions or PostGIS (recommend `earthdistance` — same as TeslaMate, lighter dependency).

### 5.19 Odometer-based summaries
- **Pattern**: `mileage.json` UNION
- **Riviamigo**: requires `start_km`/`end_km` on `trips`. Currently `trips.distance_miles` is a delta only — add `start_odometer_mi`/`end_odometer_mi`.

### 5.20 Monthly / yearly rollups
- **Pattern**: `date_trunc('month', date)` GROUP BY in `statistics.json`
- **Riviamigo**: add `efficiency_daily`, `charging_daily`, `odometer_daily` rollup tables (Section 8) for fast Statistics dashboard.

### 5.21 Per-car efficiency coefficient
- **Where**: `Log.recalculate_efficiency/3`
- **Formula**: average over completed charges where `duration_min > 10 AND end_battery_level <= 95`, of:
  ```
  charge_energy_added / (end_rated_range_km - start_rated_range_km)
  ```
  (i.e., kWh per km of range added)
- **Riviamigo**: optional. Skip — Rivian's `battery_capacity_wh` lets us go directly from SOC to kWh without a coefficient.

### 5.22 Tesla-specific assumptions called out
- `usable_battery_level` vs `battery_level` — not present in Rivian
- `ideal/rated/est` range triplet — collapsed to single field
- `charger_phases` AC/DC inference — replaced by direct `charger_type`
- `fast_charger_brand='Tesla'` — replaced by RAN / EA / EVgo provider taxonomy
- `'asleep'` state — replaced by `power_state='sleep'` from Rivian
- `cars.efficiency` coefficient — replaced by `vehicles.battery_capacity_wh`

---

## 6. Rivian Telemetry Mapping

### 6.1 Current Riviamigo telemetry (from `apps/api/src/ingestion/parser.rs` and migrations)

Captured fields per telemetry sample:
- **Identity**: `vehicle_id`, `ts`
- **Location**: `latitude`, `longitude`, `altitude_m`, `heading_deg`, `speed_mph`
- **Battery**: `battery_level` (%), `battery_capacity_wh`, `distance_to_empty_mi`, `battery_limit` (%)
- **Power**: `power_state` (sleep/ready/go/drive/charging), `power_kw`, `regen_power_kw`
- **Charging**: `charger_state`, `charger_status`, `time_to_end_of_charge_min`
- **Drive**: `drive_mode`, `gear_status`, `odometer_miles`
- **Climate**: `cabin_temp_c`, `driver_temp_c`, `outside_temp_c`, `hvac_active`
- **Tires**: `tire_{fl,fr,rl,rr}_psi`, `tire_{fl,fr,rl,rr}_status`
- **Closures**: 8 door locked/closed booleans, frunk/liftgate/tailgate locked/closed
- **Software**: `ota_current_version`, `ota_available_version`, `ota_status`, `ota_current_status`
- **Health**: `hv_thermal_event`, `twelve_volt_health`, `is_online`

Raw snapshots: **NOT preserved as-is** — parser maps to `telemetry` columns. Full raw JSON should be retained in a `telemetry_raw` blob table for debugging and reprocessing [recommended in Section 8].

State transitions: captured implicitly via `power_state` and `charger_state` columns. The `trip_detector.rs` and `charge_detector.rs` modules consume these to emit completed sessions.

### 6.2 Mapping table

| TeslaMate Concept | TeslaMate Source Fields | Rivian Equivalent Field(s) | Current Riviamigo Support | Gap / Action Required |
|---|---|---|---|---|
| Vehicle identity | `cars.eid`, `vid`, `vin` | Rivian vehicle UUID, VIN | `vehicles.id`, `rivian_vehicle_id`, `vin` | OK |
| Display name | `cars.name`, `marketing_name` | user-set | `vehicles.name` | OK; consider `marketing_name` derived from model/trim |
| Odometer | `positions.odometer` (km) | `vehicleMileage` (m → mi) | `telemetry.odometer_miles` | OK; add `trips.start_odometer_mi`/`end_odometer_mi` |
| Lat/Lon | `positions.latitude/longitude` | `gnssLocation` | `telemetry.latitude`/`longitude` | OK; add GIST index on `ll_to_earth(lat,lon)` |
| Heading | n/a | `gnssBearing` | `telemetry.heading_deg` | OK |
| Speed | `positions.speed` | `gnssSpeed` (m/s → mph) | `telemetry.speed_mph` | OK |
| Elevation | `positions.elevation` | `gnssAltitude` | `telemetry.altitude_m` | OK; derive `ascent`/`descent` per trip |
| Battery SOC | `battery_level`, `usable_battery_level` | `batteryLevel` (single %) | `telemetry.battery_level` | OK; **document that there is no `usable` distinction** |
| Estimated range | `ideal/rated/est_range_km` | `distanceToEmpty` | `telemetry.distance_to_empty_mi` | OK; single value only |
| Charging state | `charge_state.charging_state` | `chargerState`, `chargerStatus` | `telemetry.charger_state`/`charger_status` | OK |
| Plugged-in state | derived from charging_state | `chargerState ∈ {Connected,Charging,Done}` | derivable | Add convenience boolean? optional |
| Charge power | `charges.charger_power` | `vehiclePowerOutput` (during charging) | `telemetry.power_kw` (negative-on-charge?) | **Verify sign convention** in parser; integrate `power_kw` over time during charging for `energy_used_wh` |
| Charger voltage/current | `charger_voltage`, `charger_actual_current`, `charger_phases` | **NOT exposed by Rivian** | n/a | **[Rivian-gap]** — derive via `power_kw` only |
| Charger type | `fast_charger_present`, `fast_charger_brand` | `chargerStatus`/`chargerState` strings + power magnitude | `charge_sessions.charger_type ('ac'/'dc'/'dcfc')` | OK; verify classifier in `charge_detector.rs` |
| Charge limit | `charge_state.charge_limit_soc` | `batteryLimit` | `telemetry.battery_limit`, `charge_sessions.charge_limit` | OK |
| Gear / drive state | `shift_state` | `gearStatus` | `telemetry.gear_status` | OK |
| Drive mode | n/a (Tesla) | `driveMode` | `telemetry.drive_mode` | Bonus for Riviamigo — TeslaMate has no equivalent |
| Online / asleep | `states.state` (online/offline/asleep) | `powerState` + `cloudConnection.isOnline` | `telemetry.power_state`, `is_online` | Add `vehicle_state_periods` table |
| Climate state | `is_climate_on` | `cabinClimate.Running` | `telemetry.hvac_active` | OK |
| Cabin temp | `inside_temp` | `interiorTemperature` | `telemetry.cabin_temp_c` | OK |
| Outside temp | `outside_temp` | `exteriorTemperature` | `telemetry.outside_temp_c` | OK |
| Tire pressure | `tpms_pressure_*` | `tirePressure*` | `telemetry.tire_*_psi` | OK |
| Doors / closures | n/a in TeslaMate | doors+frunk+liftgate+tailgate | already captured | Bonus |
| Software version | `updates.version` | `otaCurrentVersion` | `telemetry.ota_current_version` | Add `software_versions` periods table |

### 6.3 Critical mapping decisions
1. **`telemetry.power_kw` sign convention** must be unambiguous and documented. Recommend: positive = traction (driving), negative = regen, negative-or-magnitude = grid intake during charging. Verify in parser and write inline comment in `parser.rs`.
2. **`charger_type` classification** must be explicit at session-write time. Suggested rule:
   - `peak_kw < 12` → `'ac'` (Level 1/2)
   - `peak_kw >= 12 AND peak_kw < 50` → `'ac'` (high-amp Level 2)
   - `peak_kw >= 50` → `'dc'` (DCFC)
   - flag RAN by location/geofence.
3. **`power_state='sleep'`** maps to TeslaMate's `'asleep'` for state-timeline rendering.

---

## 7. Riviamigo Schema Readiness Assessment

| Domain | Readiness | Notes |
|---|---|---|
| Vehicle overview | **Ready** | All live status fields captured; need an aggregated endpoint |
| Live status | **Ready** | `vehicles/:id/status` exists; verify all closures/OTA fields surfaced |
| Drive/trip history | **Partially Ready** | `trips` exists; **gaps**: `start_odometer_mi`/`end_odometer_mi`, `start_address_id`/`end_address_id`, `start_geofence_id`/`end_geofence_id`, `descent_m`, `power_max_kw`, `power_min_kw` |
| Charging sessions | **Partially Ready** | `charge_sessions` exists; **gaps**: `energy_used_wh` (integrated, separate from reported `energy_added_wh`), `geofence_id`, `address_id`, `avg_charge_rate_kw`, `peak_voltage` (if derivable) |
| Charging cost | **Not Ready** | No `cost_profiles` table; no geofence linkage; `cost_usd` is currently set how? Likely null/static |
| Energy efficiency | **Ready** | `efficiency_trend_7d`, `efficiency_vs_temp` views exist; extend with by-mode and by-speed |
| Battery / range trends | **Partially Ready** | `battery_capacity_snapshots` exists; need a degradation **view** that computes capacity from end-of-charge samples |
| Idle drain | **Ready** | `phantom_drain_periods`/`phantom_drain_daily` views exist; add temperature filter |
| Location history | **Partially Ready** | `telemetry.lat/lon` captured; **missing GIST index**, no map aggregation endpoint, no geofence overlay |
| Geofences | **Not Ready** | No `geofences`/`addresses` tables; only `vehicles.home_latitude`/`home_longitude` single point |
| Odometer / mileage trends | **Partially Ready** | `telemetry.odometer_miles` captured; need `start_km`/`end_km` on trips and a daily rollup |
| Service / maintenance | **Not Ready** | No service schedule; consider `service_events` table |
| Tire pressure trends | **Ready** | `telemetry.tire_*_psi` captured (>0006 corrected to PSI); add tire trend chart |
| Climate usage | **Partially Ready** | `cabin_temp_c`, `outside_temp_c`, `hvac_active` captured; no aggregation |
| Software update history | **Partially Ready** | `ota_*` captured per sample; need `software_versions` periods table populated on version change |
| Data quality / collector | **Partially Ready** | `vehicle_runtime_state` exists; need polling-gap detection view |

### 7.1 Highest-impact schema additions
1. **`geofences` + `addresses`** — prerequisite for cost dashboard, location dashboard, and home/public charging classification.
2. **`drive_id` / `charge_session_id` denormalization on `telemetry`** — drives query performance from O(time-window scan) to O(index lookup).
3. **`cost_profiles`** + `vehicles.cost_profile_id` (or per-geofence) — enables real cost numbers.
4. **`vehicle_state_periods`** — enables States timeline dashboard.
5. **Daily rollups** (`odometer_daily`, `efficiency_daily`, `charging_daily`) — enable Statistics dashboard at scale.

### 7.2 Backfill feasibility
- **Backfillable from `telemetry`**: `drive_id` denormalization (re-run trip detector against historical telemetry), `vehicle_state_periods` (run-length encoding over `power_state`), `software_versions` (RLE over `ota_current_version`), trip `start_odometer_mi`/`end_odometer_mi` (lookup at boundary timestamps), `geofence_id`/`address_id` linkages (point-in-polygon over current geofences against trip start/end positions).
- **Cannot be backfilled**: `energy_used_wh` integrated from `power_kw` IF `power_kw` was nullable historically — verify migration 0002 added it as not-backfilled. For early data, fall back to reported `energy_added_wh`.

---

## 8. Recommended Riviamigo Data Model

This section proposes the target schema. **Italic** = new; non-italic = exists.

### 8.1 Existing tables (unchanged)
- `users`, `vehicles`, `vehicle_credentials`, `vehicle_runtime_state`, `refresh_tokens`, `user_preferences`, `api_keys`, `system_config`, `dashboards`, `vehicle_images`, `battery_capacity_snapshots`

### 8.2 Existing tables (additions recommended)

**`vehicles`** — add columns:
```sql
ALTER TABLE riviamigo.vehicles
  ADD COLUMN display_priority SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN cost_profile_id UUID REFERENCES riviamigo.cost_profiles(id),
  ADD COLUMN home_geofence_id UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN firmware_version TEXT;
```

**`trips`** — add columns:
```sql
ALTER TABLE riviamigo.trips
  ADD COLUMN start_odometer_mi DOUBLE PRECISION,
  ADD COLUMN end_odometer_mi   DOUBLE PRECISION,
  ADD COLUMN start_position_ts TIMESTAMPTZ,  -- FK-by-time into telemetry
  ADD COLUMN end_position_ts   TIMESTAMPTZ,
  ADD COLUMN start_geofence_id UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN end_geofence_id   UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN start_address_id  UUID REFERENCES riviamigo.addresses(id),
  ADD COLUMN end_address_id    UUID REFERENCES riviamigo.addresses(id),
  ADD COLUMN power_max_kw      DOUBLE PRECISION,
  ADD COLUMN power_min_kw      DOUBLE PRECISION,
  ADD COLUMN elevation_loss_m  DOUBLE PRECISION,
  ADD COLUMN inside_temp_avg_c DOUBLE PRECISION,
  ADD COLUMN energy_strategy   TEXT;            -- 'soc_delta' | 'range_delta' | 'historical'
CREATE INDEX trips_geofence_start_idx ON riviamigo.trips(start_geofence_id);
CREATE INDEX trips_geofence_end_idx   ON riviamigo.trips(end_geofence_id);
```

**`charge_sessions`** — add columns:
```sql
ALTER TABLE riviamigo.charge_sessions
  ADD COLUMN energy_used_wh    DOUBLE PRECISION,   -- integrated from power_kw
  ADD COLUMN avg_charge_rate_kw DOUBLE PRECISION,
  ADD COLUMN geofence_id       UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN address_id        UUID REFERENCES riviamigo.addresses(id),
  ADD COLUMN cost_profile_id   UUID REFERENCES riviamigo.cost_profiles(id),
  ADD COLUMN cost_method       TEXT;               -- 'profile' | 'manual' | 'unknown'
CREATE INDEX cs_geofence_idx ON riviamigo.charge_sessions(geofence_id);
```

**`telemetry`** (TimescaleDB hypertable) — add columns and indexes:
```sql
ALTER TABLE timeseries.telemetry
  ADD COLUMN trip_id           UUID,
  ADD COLUMN charge_session_id UUID;
CREATE INDEX telemetry_trip_idx
  ON timeseries.telemetry(trip_id, ts) WHERE trip_id IS NOT NULL;
CREATE INDEX telemetry_charge_idx
  ON timeseries.telemetry(charge_session_id, ts) WHERE charge_session_id IS NOT NULL;
-- Spatial
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE INDEX telemetry_ll_idx
  ON timeseries.telemetry USING gist (ll_to_earth(latitude, longitude))
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
```

### 8.3 New tables

#### *`addresses`* (cache, optional Nominatim)
```sql
CREATE TABLE riviamigo.addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT NOT NULL,
  osm_id          BIGINT UNIQUE,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  road            TEXT,
  city            TEXT,
  state           TEXT,
  postcode        TEXT,
  country         TEXT,
  raw             JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX addresses_ll_idx ON riviamigo.addresses
  USING gist (ll_to_earth(latitude, longitude));
```

#### *`geofences`*
```sql
CREATE TABLE riviamigo.geofences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  radius_m        DOUBLE PRECISION NOT NULL DEFAULT 50,
  address_id      UUID REFERENCES riviamigo.addresses(id),
  cost_profile_id UUID REFERENCES riviamigo.cost_profiles(id),
  is_home         BOOLEAN NOT NULL DEFAULT FALSE,
  is_work         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX geofences_user_idx ON riviamigo.geofences(user_id);
CREATE INDEX geofences_ll_idx   ON riviamigo.geofences
  USING gist (ll_to_earth(latitude, longitude));
```

#### *`cost_profiles`*
```sql
CREATE TABLE riviamigo.cost_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  billing_type  TEXT NOT NULL CHECK (billing_type IN ('per_kwh','per_minute','free','flat')),
  rate          NUMERIC(10,4) NOT NULL DEFAULT 0,    -- $/kWh or $/min or $/session
  session_fee   NUMERIC(8,2)  NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  effective_from DATE,
  effective_to   DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX cost_profiles_user_idx ON riviamigo.cost_profiles(user_id);
```

#### *`vehicle_state_periods`* (states timeline)
```sql
CREATE TABLE riviamigo.vehicle_state_periods (
  id           BIGSERIAL PRIMARY KEY,
  vehicle_id   UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  state        TEXT NOT NULL CHECK (state IN
                  ('drive','charging','ready','sleep','offline','updating','unknown')),
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  duration_seconds INT GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::INT END) STORED
);
CREATE INDEX vsp_open_idx ON riviamigo.vehicle_state_periods(vehicle_id)
  WHERE ended_at IS NULL;
CREATE INDEX vsp_range_idx ON riviamigo.vehicle_state_periods(vehicle_id, started_at DESC);
```

#### *`software_versions`* (firmware history)
```sql
CREATE TABLE riviamigo.software_versions (
  id           BIGSERIAL PRIMARY KEY,
  vehicle_id   UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL,
  observed_until TIMESTAMPTZ
);
CREATE INDEX sv_vehicle_idx ON riviamigo.software_versions(vehicle_id, installed_at DESC);
```

#### *`service_events`* (manual entries)
```sql
CREATE TABLE riviamigo.service_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,                      -- 'tire_rotation','wiper','recall', ...
  performed_at TIMESTAMPTZ NOT NULL,
  odometer_mi DOUBLE PRECISION,
  cost_usd    NUMERIC(10,2),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### *`telemetry_raw`* (debug/reprocessing) — **optional**
```sql
CREATE TABLE timeseries.telemetry_raw (
  ts          TIMESTAMPTZ NOT NULL,
  vehicle_id  UUID NOT NULL,
  source      TEXT NOT NULL,    -- 'ws' | 'poll'
  payload     JSONB NOT NULL
);
SELECT create_hypertable('timeseries.telemetry_raw', 'ts',
  chunk_time_interval => INTERVAL '1 day');
-- Aggressive retention: 30 days
SELECT add_retention_policy('timeseries.telemetry_raw', INTERVAL '30 days');
```

### 8.4 Daily rollup tables (continuous aggregates)

Use TimescaleDB **continuous aggregates** over `telemetry`, plus regular tables for trips/charges rollups.

#### *`odometer_daily`* (CAGG over telemetry)
```sql
CREATE MATERIALIZED VIEW timeseries.odometer_daily
  WITH (timescaledb.continuous) AS
SELECT vehicle_id,
       time_bucket('1 day', ts) AS day,
       max(odometer_miles) AS odometer_end,
       max(odometer_miles) - min(odometer_miles) AS miles_driven
FROM timeseries.telemetry
WHERE odometer_miles IS NOT NULL
GROUP BY vehicle_id, day;
SELECT add_continuous_aggregate_policy('timeseries.odometer_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');
```

#### *`efficiency_daily`* (CAGG over trips)
```sql
CREATE MATERIALIZED VIEW riviamigo.efficiency_daily AS
SELECT vehicle_id,
       date_trunc('day', started_at) AS day,
       SUM(distance_miles)            AS miles_driven,
       SUM(energy_wh)                 AS energy_wh,
       SUM(regen_wh)                  AS regen_wh,
       CASE WHEN SUM(distance_miles)>0
            THEN SUM(energy_wh)/SUM(distance_miles) END AS wh_per_mile,
       AVG(outside_temp_c)            AS avg_outside_temp_c,
       COUNT(*)                       AS trip_count
FROM riviamigo.trips
GROUP BY vehicle_id, day;
-- refresh in cron job nightly OR convert to a TimescaleDB CAGG if trips becomes a hypertable
```

#### *`charging_daily`*
```sql
CREATE MATERIALIZED VIEW riviamigo.charging_daily AS
SELECT vehicle_id,
       date_trunc('day', started_at) AS day,
       COUNT(*)                                      AS session_count,
       SUM(energy_added_wh)/1000.0                   AS kwh_added,
       SUM(COALESCE(energy_used_wh, energy_added_wh))/1000.0 AS kwh_used,
       SUM(cost_usd)                                 AS cost_usd,
       SUM(CASE WHEN is_home   THEN energy_added_wh ELSE 0 END)/1000.0 AS kwh_home,
       SUM(CASE WHEN charger_type='dc' THEN energy_added_wh ELSE 0 END)/1000.0 AS kwh_dc
FROM riviamigo.charge_sessions
WHERE ended_at IS NOT NULL
GROUP BY vehicle_id, day;
```

### 8.5 Retention strategy
- `telemetry`: keep indefinitely (compress chunks > 30 days using TimescaleDB native compression).
- `telemetry_raw`: 30 days.
- `trips`, `charge_sessions`, `vehicle_state_periods`: indefinite.
- Aggregates (`*_daily`): indefinite, refresh nightly.

---

## 9. Dashboard Architecture Recommendation

### 9.1 Approach comparison

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| Embedded Grafana | Zero-cost dashboards, exact TeslaMate parity | Extra service, auth bridging, ugly mobile, conflicts with Riviamigo's branded design system | **Reject** |
| Native React (current) | Branded UX, mobile-first, single auth, integrated with dashboard editor | More backend work | **Keep** — already chosen |
| Hybrid | Grafana for power users, native for default | Two systems to maintain | **Optional** — expose Grafana datasource at `routes/grafana.rs` for power users (already in the API tree) |
| SQL views / matviews | Fast queries, simple | Refresh management | **Keep** — already used (`telemetry_1min`, etc.) |
| Server-side analytics API | Single source of truth, cacheable | More endpoints | **Keep** — fits Riviamigo's Rust-backed API |
| Client-side charting | Already in place (Recharts) | Heavy data over wire if not aggregated | **Keep**, with server-side aggregation |

### 9.2 Recommended architecture

```
React (apps/web)
  └── DashboardRenderer (packages/dashboards)
       └── Widget hooks (packages/hooks) — TanStack Query
            └── HTTP → /v1/* (apps/api Axum routes)
                 └── Service layer (Rust)
                      └── Postgres (riviamigo + timeseries schemas)
                           └── Continuous aggregates + materialized views
                           └── Hypertable `telemetry`
                           └── Normalized tables (trips, charge_sessions, geofences, ...)
```

### 9.3 Specific recommendations
- **Backend aggregation layer**: Rust services in `apps/api/src/services/` (new), one per analytics domain. Keep route handlers thin.
- **Frontend**: existing pattern (`packages/hooks` + `packages/ui/charts`). Charting library: **Recharts** (already used) for simple charts; consider **VisX** or **Plotly** for the Map and Heatmap if Recharts is limiting.
- **Caching**: Redis for short-TTL hot endpoints (overview dashboard, live status). 30s TTL for live, 10min for daily aggregates, 1h for monthly rollups.
- **Query performance**:
  - Use continuous aggregates for time-series rollups.
  - Add `(vehicle_id, trip_id, ts)` composite index on telemetry.
  - Always filter by `vehicle_id` first (hypertable space partition).
- **Materialized rollups**: see Section 8.4.
- **Timezone handling**: store `TIMESTAMPTZ` everywhere; convert to user's `home_timezone` (already in `user_preferences`) at presentation.
- **Unit conversion**: keep in TypeScript hooks (`packages/hooks`) using `user_preferences.distance_unit`/`temperature_unit`. Don't add SQL `convert_*` functions — different from TeslaMate, but cleaner with TS unit type guards.
- **Privacy / local-first**: skip Nominatim by default; user opts in. Geofences only stored when user creates them. See Section 18.

---

## 10. Riviamigo Dashboard Plan

Each dashboard below maps to a `riviamigo.dashboards` row (`is_default=true`, `is_locked=true`) seeded at install. All widgets reference `widgetId` registry keys in `packages/dashboards/src/registry.tsx`.

### 10.1 Overview Dashboard
- **Purpose**: At-a-glance "what's the truck doing right now"
- **Questions**: Where is it? Plugged in? SOC? Range? Last drive? Today's miles?
- **Panels**:
  - `stat.live_soc` — battery %, color by level
  - `stat.live_range` — range in mi, secondary line: "EPA range × SOC%"
  - `stat.live_state` — power_state badge with last_event_at relative time
  - `card.live_location` — mini-map with current pin + reverse-geocoded address (cached)
  - `card.charging_status` — if charging: kW, time-to-full, SOC progress bar
  - `chart.soc_24h` — last 24h SOC area chart
  - `stat.today_distance` — miles driven today (from `odometer_daily`)
  - `stat.recent_efficiency` — Wh/mi over last 7 days
  - `card.last_drive` — distance, duration, efficiency, end location
  - `card.last_charge` — kWh added, cost, location
  - `strip.state_timeline` — 24h horizontal state strip (drive/charge/sleep/etc.)
- **Backend endpoints**: `GET /api/dashboard/overview?vehicle_id=…`
- **Empty states**: "No drives yet today", "Vehicle offline since {ts}"
- **Edge cases**: vehicle never seen → show onboarding tile.

### 10.2 Drives Dashboard
- **Purpose**: Drive history + per-drive deep-dive
- **Panels**:
  - `chart.drives_per_day` — bar chart, days × count
  - `table.drives_list` — sortable, columns: start, end, distance, duration, max_speed, soc_start→end, efficiency, drive_mode, start→end location
  - `chart.distance_over_time`
  - `chart.efficiency_per_drive`
  - **Detail page** `/drives/:id`:
    - Map route (telemetry where `trip_id=...`)
    - Speed profile (line chart, ts × speed)
    - Elevation profile
    - SOC profile
    - Power profile (traction + regen)
    - Aggregates card
- **Endpoints**: `GET /v1/trips`, `GET /v1/trips/:id`, `GET /v1/trips/:id/track`, `/speed`, `/elevation`, `/power`
- **Empty states**: prompt to drive
- **Edge cases**: GPS gap → render dashed line; trip with `ended_at IS NULL` → "in progress"

### 10.3 Charging Dashboard
- **Panels**:
  - `table.charging_sessions` — start, location_name, charger_type badge, energy_added, peak_kw, duration, soc_start→end, cost
  - `chart.charging_curve` — for selected session: power vs SOC
  - `stat.kwh_total` / `stat.cost_total` / `stat.session_count`
  - `chart.home_vs_public` — donut by `is_home`
  - `chart.ac_vs_dc` — donut by `charger_type`
  - `chart.charging_per_week`
- **Endpoints**: `GET /v1/charging/sessions`, `/summary`, `/curve?session_id=…`
- **Edge cases**: session with no `ended_at` → "in progress"; missing cost → show "no cost profile" with link to Cost dashboard

### 10.4 Efficiency Dashboard
- **Panels**:
  - `stat.avg_wh_per_mile` (period)
  - `chart.efficiency_trend_7d`
  - `chart.efficiency_vs_temp` (existing view)
  - `chart.efficiency_by_speed` (new — bin by 10mph buckets) **[Gap]**
  - `chart.efficiency_by_drive_mode` (sport/everyday/conserve/off_road_auto)
  - `chart.efficiency_per_trip` (scatter, distance × wh/mi)
- **Endpoints**: `GET /v1/efficiency/{summary,vs-temp,vs-speed,by-mode,trend}`

### 10.5 Battery & Range Dashboard
- **Panels**:
  - `chart.soc_history` — long-range SOC area chart
  - `chart.range_history`
  - `chart.charge_limit_history` (from `telemetry.battery_limit`)
  - `chart.degradation` — kWh capacity from `battery_capacity_snapshots` + computed-from-charge-end view; **caveat banner**: "Estimate based on end-of-charge SOC; ±5% accuracy"
  - `chart.projected_full_range` — `distance_to_empty_mi / battery_level * 100` rolling
- **Endpoints**: `GET /v1/battery/{soc,range,degradation,charge-limit}`

### 10.6 Idle Drain Dashboard
- **Panels**:
  - `stat.avg_drain_per_hour` / `per_day`
  - `chart.drain_over_time` (from `phantom_drain_daily`)
  - `table.parked_sessions` — start, end, location, soc_lost, hours, drain_rate, outside_temp_avg
  - `chart.drain_by_temp` (binned)
  - `chart.drain_by_location` (group by geofence_id)
- **Endpoints**: `GET /v1/vehicles/:id/idle-drain`
- **Edge cases**: filter out sessions where `outside_temp_c < -5` OR `hvac_active` true at any point

### 10.7 Location Dashboard
- **Panels**:
  - `map.visited_heatmap` — minute-bucketed `telemetry` points
  - `map.geofences` — overlay with edit
  - `table.top_destinations` — group trips by `end_geofence_id`
  - `table.top_charge_locations` — group `charge_sessions` by `geofence_id`
  - `chart.distance_per_location`
  - `geofence_editor` — create/edit/delete geofences with cost profile dropdown
- **Endpoints**: `GET /v1/vehicles/:id/locations`, `GET /v1/geofences`, `POST/PUT/DELETE /v1/geofences/:id`

### 10.8 Cost Dashboard
- **Panels**:
  - `card.cost_profiles_editor` — manage rate cards
  - `stat.month_to_date_cost`
  - `stat.cost_per_mile`
  - `chart.cost_per_month` (12 months stacked: home vs public)
  - `chart.cost_per_session` (scatter)
  - `stat.fuel_savings_estimate` — `(miles × $/mi_gas) - cost_usd`
  - `table.uncategorized_charges` — sessions with `cost_method='unknown'`, prompt to assign profile
- **Endpoints**: `GET /v1/cost-profiles`, POST/PUT/DELETE; `GET /v1/vehicles/:id/costs`

### 10.9 Vehicle Health Dashboard
- **Panels**:
  - `stat.tire_pressures` (4-corner gauges, threshold from `tire_*_status`)
  - `chart.tire_pressure_history`
  - `card.software_version` (current + history table from `software_versions`)
  - `card.12v_battery_health` — based on `twelve_volt_health`
  - `card.thermal_events` — recent `hv_thermal_event ≠ null`
  - `card.closures` — current door/frunk/liftgate state
- **Endpoints**: `GET /v1/vehicles/:id/health`

### 10.10 Data Quality / Collector Dashboard
- **Panels**:
  - `stat.last_event_at` (from `vehicle_runtime_state`)
  - `stat.worker_health` (`connected`/`needs_reauth`/...)
  - `chart.polling_gaps` — gaps > 5min in last 24h
  - `chart.sample_rate_per_hour`
  - `stat.completeness_score` — % of expected fields populated last 24h
  - `table.recent_errors` — from `vehicle_runtime_state.worker_health_msg` (or new `worker_events` table)
- **Endpoints**: `GET /v1/vehicles/:id/data-quality`

---

## 11. Calculation Specification for Riviamigo

For each metric: **formula | source | unit | aggregation | timezone | missing | outliers | limits**.

### 11.1 Distance driven (per trip)
- **Formula**: `MAX(odometer_miles) - MIN(odometer_miles)` over `telemetry WHERE trip_id = $id`
- **Unit**: miles (storage); convert per `user_preferences.distance_unit`
- **Missing**: if odometer null > 50% of trip → fall back to integration of `speed_mph * Δt`
- **Outliers**: drop trips with negative delta (odometer reset)
- **Aggregation**: SUM for daily/monthly

### 11.2 Drive duration
- **Formula**: `MAX(telemetry.ts) - MIN(telemetry.ts)` WHERE `trip_id=$id`
- **Unit**: seconds

### 11.3 Estimated energy used (per trip) — RIVIAN-CRITICAL
Rivian does not expose per-drive kWh. Use this ranked ensemble:
1. **SOC delta × pack capacity** (preferred when SOC delta ≥ 1%):
   ```
   energy_wh ≈ (soc_start - soc_end) / 100.0 * battery_capacity_wh
   ```
2. **Range delta × per-vehicle efficiency** (when SOC delta < 1% but range delta ≥ 1mi):
   ```
   energy_wh ≈ (range_start - range_end) * efficiency_wh_per_mi_recent
   ```
3. **Distance × historical efficiency** (final fallback):
   ```
   energy_wh ≈ distance_miles * lookup_efficiency(drive_mode, outside_temp_bucket)
   ```
- **Storage**: `trips.energy_wh` (existing) + `trips.energy_strategy` (new) recording which method was used.
- **Caveat**: surface in UI tooltip when strategy != #1.

### 11.4 Efficiency (Wh/mi)
- **Formula**: `trips.energy_wh / trips.distance_miles` (per trip); period-weighted avg = `SUM(energy_wh) / SUM(distance_miles)` (NOT mean of per-trip)
- **Outlier filter**: exclude trips < 1 mi or with `energy_wh` from strategy #3

### 11.5 Charging duration
- `ended_at - started_at` in minutes; null if `ended_at IS NULL`

### 11.6 Energy added (charging, reported)
- **Formula**: stored `charge_sessions.energy_added_wh`, sourced as `MAX(soc) at ended_at - MIN(soc) at started_at` × `battery_capacity_wh / 100`. **Note**: Rivian's reported field name TBD — verify in `parser.rs`. If a direct field exists, prefer it.

### 11.7 Energy used (charging, integrated)
- **Formula**:
  ```
  energy_used_wh = Σ (|power_kw_at_t| * 1000 * Δt_seconds / 3600)
  ```
  over `telemetry WHERE charge_session_id=$id`. `power_kw` should be negative during charging — take absolute value.
- **Limitation**: Rivian polling is 30s during charging (per current poller config) — sufficient resolution.

### 11.8 Charging speed (mi/h added)
- `(end_range - start_range) / duration_hours`

### 11.9 Charging cost
- **Formula**:
  ```
  if cost_profile.billing_type='per_kwh':
    cost = rate * GREATEST(energy_added_kwh, energy_used_kwh) + session_fee
  if cost_profile.billing_type='per_minute':
    cost = rate * duration_minutes + session_fee
  if cost_profile.billing_type='free': cost = 0
  if cost_profile.billing_type='flat': cost = rate + session_fee
  ```
- **Selection**: profile chosen by (1) `charge_sessions.cost_profile_id` if explicitly set; (2) `geofences.cost_profile_id` if session matches a geofence; (3) `vehicles.cost_profile_id` (default home rate); (4) null → mark `cost_method='unknown'`.

### 11.10 Idle drain (per parked session)
- **Formula** (current Riviamigo, in `phantom_drain_periods`):
  `(soc_start - soc_end) / hours_elapsed` for periods of `power_state ∈ {sleep, ready}` ≥ `$min_idle`
- **Filter**: exclude periods with `outside_temp_c < -5°C` OR any `hvac_active=true` sample

### 11.11 Daily mileage
- **Source**: `odometer_daily.miles_driven`

### 11.12 Monthly mileage
- **Aggregation**: `SUM(miles_driven) GROUP BY date_trunc('month', day)`

### 11.13 Average SOC
- **Period avg**: `AVG(battery_level) FROM telemetry WHERE ts BETWEEN x AND y`. Time-weighted preferred (use TimescaleDB `time_weight()`).

### 11.14 SOC delta (per trip)
- `soc_start - soc_end` (already on `trips`)

### 11.15 Range delta (per trip)
- `range_start - range_end` (need columns added to `trips`: `range_start_mi`, `range_end_mi`) **[Gap]**

### 11.16 Cost per mile
- **Formula**: `SUM(cost_usd) / SUM(miles_driven)` over period
- **Caveat**: only meaningful if cost coverage > 80% of charging sessions

### 11.17 Average charging power
- `energy_used_kwh / duration_hours` per session

### 11.18 Percent home charging
- `SUM(kwh WHERE is_home=true) / SUM(kwh) * 100` over period

### 11.19 Data completeness
- **Formula**: per 1-hour window, ratio of expected-non-null fields populated, normalized.
  ```
  for each hour:
    expected = count of fields that should be populated based on power_state
    actual   = count of those fields that have at least one non-null sample
    score    = actual / expected
  daily completeness = avg(hourly score)
  ```
- Surface as 0–100 health score on Data Quality dashboard.

---

## 12. API / Backend Implementation Plan

All routes under `apps/api/src/routes/`. Service layer in `apps/api/src/services/` (new). Request auth: existing JWT or API key middleware (`middleware/auth.rs`).

Common conventions:
- Vehicle scope: `:vehicle_id` path param; middleware verifies user-vehicle ownership.
- Date range: `from`, `to` ISO 8601 query params; default last 30d.
- Pagination: `limit` (default 50, max 500), `cursor` (opaque base64).
- Response envelope: `{ data: T, meta?: { ... } }`. Errors: `{ error: { code, message } }`.

### 12.1 Endpoint inventory

| Method+Path | Purpose | Backing data | Notes |
|---|---|---|---|
| `GET /v1/dashboard/overview/:vehicle_id` | Aggregated overview tiles | `vehicle_runtime_state`, latest `telemetry`, latest `trips`/`charge_sessions`, `odometer_daily` | Cache 30s |
| `GET /v1/vehicles/:vid/drives` | List trips | `trips` | filters: `from`, `to`, `min_distance`, `drive_mode` |
| `GET /v1/vehicles/:vid/drives/:trip_id` | Drive detail | `trips` + JOIN start/end address+geofence | |
| `GET /v1/vehicles/:vid/drives/:trip_id/track` | Route polyline | `telemetry WHERE trip_id=...` | Decimate using Douglas-Peucker for >1000 points |
| `GET /v1/vehicles/:vid/drives/:trip_id/speed` | Speed profile | telemetry | |
| `GET /v1/vehicles/:vid/drives/:trip_id/elevation` | Elevation profile | telemetry | |
| `GET /v1/vehicles/:vid/drives/:trip_id/power` | Power profile | telemetry | |
| `GET /v1/vehicles/:vid/charging-sessions` | List sessions | `charge_sessions` | filters: `is_home`, `charger_type` |
| `GET /v1/vehicles/:vid/charging-sessions/:id` | Session detail | + cost_profile JOIN | |
| `GET /v1/vehicles/:vid/charging-sessions/:id/curve` | Power vs SOC | telemetry where `charge_session_id=$id` | |
| `GET /v1/vehicles/:vid/efficiency/summary` | Period summary | `efficiency_daily` | |
| `GET /v1/vehicles/:vid/efficiency/by-mode` | Group by drive_mode | `trips` | |
| `GET /v1/vehicles/:vid/efficiency/vs-temp` | Existing | `efficiency_vs_temp` | |
| `GET /v1/vehicles/:vid/efficiency/vs-speed` | New | `trips` bucketed | |
| `GET /v1/vehicles/:vid/efficiency/trend` | Existing | `efficiency_trend_7d` | |
| `GET /v1/vehicles/:vid/battery/soc` | SOC time series | telemetry hypertable, time_bucket | |
| `GET /v1/vehicles/:vid/battery/range` | Range time series | | |
| `GET /v1/vehicles/:vid/battery/degradation` | kWh capacity trend | `battery_capacity_snapshots` + computed view | |
| `GET /v1/vehicles/:vid/battery/charge-limit` | Charge limit history | telemetry | |
| `GET /v1/vehicles/:vid/idle-drain` | Idle drain summary + sessions | `phantom_drain_periods/daily` | filter by `geofence_id`, temp range |
| `GET /v1/vehicles/:vid/locations` | Geomap aggregation | telemetry, geofences | |
| `GET /v1/geofences` | List user geofences | `geofences` | |
| `POST /v1/geofences` | Create geofence | | |
| `PUT /v1/geofences/:id` | Update | | |
| `DELETE /v1/geofences/:id` | Delete | | |
| `GET /v1/cost-profiles` | List | `cost_profiles` | |
| `POST/PUT/DELETE /v1/cost-profiles/:id` | CRUD | | |
| `GET /v1/vehicles/:vid/costs` | Cost summary | `charging_daily` + cost recompute | |
| `GET /v1/vehicles/:vid/health` | Vehicle health snapshot | latest telemetry, software_versions | |
| `GET /v1/vehicles/:vid/data-quality` | Polling gaps & completeness | telemetry analysis | |
| `GET /v1/vehicles/:vid/state-timeline` | State timeline | `vehicle_state_periods` | |

### 12.2 Service-layer functions
- `services::overview::build_overview(vehicle_id) -> OverviewDto`
- `services::trips::list(vehicle_id, filter) -> Vec<TripDto>`
- `services::trips::get_track(trip_id, simplify_tolerance) -> Polyline`
- `services::charging::compute_cost(session, profile) -> Money`
- `services::cost::resolve_profile(session) -> Option<CostProfile>` (geofence → vehicle default)
- `services::efficiency::*` per breakdown
- `services::geofences::match_point(lat, lon) -> Option<Geofence>`
- `services::idle_drain::filtered_periods(vehicle_id, filter)`
- `services::data_quality::completeness(vehicle_id, window)`

### 12.3 Background jobs (new module `apps/api/src/jobs/`)
- `materialize_state_periods_job` — every 1 min, append open period or close on transition
- `materialize_software_versions_job` — every 1 min, write new row on `ota_current_version` change
- `refresh_efficiency_daily_job` — nightly REFRESH MATERIALIZED VIEW
- `refresh_charging_daily_job` — nightly
- `recompute_costs_job` — nightly: re-resolve cost_profile for sessions with `cost_method='unknown'`
- `geofence_match_job` — backfill: on geofence create/update, recompute matches for past trips/charges within radius
- `data_quality_alarm_job` — every 5 min, flag vehicles with `last_event_at > NOW() - 30 min` and `worker_health='connected'`

---

## 13. Frontend Implementation Plan

Path: `apps/web/src` and `packages/{ui,hooks,dashboards}`.

### 13.1 Routes
- `/` — Overview (default dashboard slug `overview`)
- `/drives` — list
- `/drives/:id` — detail
- `/charging` — list
- `/charging/:id` — session detail
- `/efficiency`
- `/battery`
- `/idle-drain`
- `/locations` — map + geofence editor
- `/costs` — profiles + summary
- `/health`
- `/data-quality`
- `/admin/dashboards` (existing) — manage dashboard configs
- `/settings` (existing)

### 13.2 New reusable components

**Charts** (`packages/ui/src/charts`):
- `MapTrackChart` — Leaflet-based route visualization (new)
- `MapHeatmap` — visited heatmap
- `GeofenceEditorMap` — leaflet draw-circle editor
- `StateTimelineStrip` — 24h horizontal stacked-bar
- `ChargeCurveChart` (exists) — extend with kw-vs-soc dual axis
- `EfficiencyVsSpeedChart` (new)
- `EfficiencyByModeChart` (new)
- `TirePressureGaugeQuad` (new) — 4-corner gauge layout
- `CompletenessScoreCard` (new)
- `PollingGapsChart` (new)

**Primitives** (`packages/ui/src/primitives`):
- `CostProfileBadge` — shows $0.13/kWh badge
- `GeofencePill` — pill with home/work/custom icon
- `DriveModeBadge`
- `ChargerTypeBadge`
- `StrategyTooltip` — explains energy strategy used (#1/#2/#3)

**Hooks** (`packages/hooks/src`):
- `useOverview(vehicleId)`
- `useTripDetail(tripId)`, `useTripTrack`, `useTripSpeed`, `useTripElevation`, `useTripPower`
- `useChargingCurve(sessionId)`
- `useGeofences()`, `useCreateGeofence`, etc.
- `useCostProfiles()`, mutations
- `useIdleDrain(filter)`
- `useStateTimeline(window)`
- `useDataQuality()`

### 13.3 Dashboard widgets registry additions

In `packages/dashboards/src/registry.tsx`, add registry keys (one component each, all calling its hook at the top):

```
'stat.live_soc'                'card.last_drive'
'stat.live_range'              'card.last_charge'
'stat.live_state'              'strip.state_timeline'
'card.live_location'           'map.visited_heatmap'
'card.charging_status'         'map.geofences'
'chart.soc_24h'                'table.top_destinations'
'chart.efficiency_by_speed'    'table.top_charge_locations'
'chart.efficiency_by_mode'     'card.cost_profiles_editor'
'chart.cost_per_month'         'card.tire_pressures'
'chart.charging_curve'         'card.software_version'
'chart.tire_pressure_history'  'chart.polling_gaps'
'stat.completeness_score'      ...
```

### 13.4 Date range, vehicle selector, units
Already provided by existing primitives (`DateRangePicker`, vehicle context, `user_preferences` hook). Verify all new charts respect them.

### 13.5 Loading / empty / error states
- **Loading**: skeleton card with shimmer.
- **Empty**: contextual CTA (e.g., "No geofences yet — create your first").
- **Error**: inline `<ErrorBanner code message />` with retry button.

---

## 14. Data Ingestion / Derivation Plan

### 14.1 Polling snapshot ingestion (current)
Already implemented. WebSocket-first, adaptive REST polling fallback. Each event → `telemetry` row.

### 14.2 State transition detection (extend current detectors)

**Pseudocode — drive detection** (refines `trip_detector.rs`):
```
state = match telemetry.power_state, telemetry.gear_status:
  ('drive'|'go'), ('D'|'R'|'N')  -> Driving
  ('drive'|'go'), 'P'             -> Stopped
  'sleep'|'ready', _              -> Parked
  'charging', _                   -> Charging

on transition (Parked|Charging) -> Driving:
  trip_id = INSERT trips (vehicle_id, started_at, start_lat, start_lng,
                           start_odometer_mi, soc_start, range_start_mi, ...)
  emit TripStarted(trip_id)

while Driving:
  UPDATE telemetry SET trip_id = $trip_id WHERE ts >= started_at AND vehicle_id = $vid
    -- (or write trip_id at insert-time once detector is online)

on transition Driving -> (Parked|Charging) AND duration_since_movement > 60s:
  UPDATE trips SET ended_at, end_*, distance_miles, max_speed_mph,
                   avg_speed_mph, energy_wh, regen_wh, efficiency_wh_per_mile,
                   elevation_gain_m, elevation_loss_m
   WHERE id = $trip_id
  emit TripEnded
```

**Pseudocode — charging detection** (refines `charge_detector.rs`):
```
on transition charger_state: not-Charging -> Charging:
  cs_id = INSERT charge_sessions (started_at, location_lat/lng, soc_start,
                                  charge_limit, ...)
  emit SessionStarted

while charger_state == 'Charging':
  UPDATE telemetry SET charge_session_id = $cs_id

on transition Charging -> (Done|Disconnected):
  classify charger_type by max(power_kw): <12 ac, <50 ac, >=50 dc
  energy_added_wh = (soc_end - soc_start)/100 * battery_capacity_wh
  energy_used_wh  = SUM(|power_kw|*1000 * Δt_s / 3600) over session telemetry
  geofence_id = match_geofence(location_lat, location_lng)
  cost_profile = resolve_profile(geofence_id, vehicle.default)
  cost_usd = compute_cost(profile, energy_added_wh, duration_min)
  UPDATE charge_sessions SET ended_at, energy_added_wh, energy_used_wh,
                             max_charge_rate_kw, avg_charge_rate_kw,
                             charger_type, geofence_id, cost_profile_id,
                             cost_usd, cost_method
```

**Pseudocode — daily odometer delta** (background job):
```
for each vehicle:
  for each day with telemetry:
    miles = MAX(odometer_miles WHERE date(ts)=day) -
            MIN(odometer_miles WHERE date(ts)=day)
    UPSERT odometer_daily (vehicle_id, day, miles_driven, odometer_end)
```

**Pseudocode — idle drain** (already implemented as view; refine):
```
phantom_drain_periods = SELECT
  vehicle_id,
  MIN(ts) AS period_start, MAX(ts) AS period_end,
  FIRST(battery_level) AS soc_start, LAST(battery_level) AS soc_end,
  ...
FROM (
  SELECT *,
         power_state,
         power_state IS DISTINCT FROM LAG(power_state) OVER (...) AS new_run
  FROM telemetry
  WHERE power_state IN ('sleep','ready')
)
GROUP BY vehicle_id, run_id
HAVING period_end - period_start > INTERVAL '15 minutes'
   AND NOT EXISTS (sample WHERE outside_temp_c < -5
                   OR hvac_active = true);
```

**Pseudocode — geofence matching**:
```
fn match_geofence(lat, lon, user_id) -> Option<Geofence>:
  point = ll_to_earth(lat, lon)
  return SELECT id, name FROM geofences
          WHERE user_id = $uid
            AND earth_box(ll_to_earth(latitude, longitude), radius_m) @> point
            AND earth_distance(ll_to_earth(latitude, longitude), point) <= radius_m
          ORDER BY earth_distance(...) ASC LIMIT 1;
```

**Pseudocode — daily/monthly rollups**:
```
nightly job:
  REFRESH MATERIALIZED VIEW efficiency_daily;
  REFRESH MATERIALIZED VIEW charging_daily;
  for each user, vehicle, day in last 90 days:
    UPSERT odometer_daily, charging_daily, ...
```

### 14.3 Repair / backfill pseudocode
```
fn backfill_drive_ids():
  for each completed trip:
    UPDATE telemetry SET trip_id = trip.id
     WHERE vehicle_id = trip.vehicle_id
       AND ts BETWEEN trip.started_at AND trip.ended_at
       AND power_state IN ('drive','go');

fn backfill_geofences(geofence):
  UPDATE trips SET start_geofence_id = geofence.id
   WHERE earth_distance(ll_to_earth(start_lat, start_lng),
                        ll_to_earth(geofence.latitude, geofence.longitude))
         <= geofence.radius_m;
  -- repeat for end_geofence_id, charge_sessions.geofence_id
```

### 14.4 Deduplication
WebSocket and REST poller may both deliver overlapping samples. Add unique constraint:
```sql
ALTER TABLE timeseries.telemetry
  ADD CONSTRAINT telemetry_unique_sample UNIQUE (vehicle_id, ts);
INSERT ... ON CONFLICT (vehicle_id, ts) DO UPDATE SET ...  -- or DO NOTHING
```
**Caveat**: TimescaleDB unique constraints must include the partition column (ts is included — fine).

### 14.5 Timezone handling
- All `TIMESTAMPTZ` storage UTC.
- Convert at API serialization to user's `home_timezone`.
- Day boundaries (for `*_daily` rollups): use `time_bucket('1 day', ts, $home_timezone)` (TimescaleDB supports tz-aware buckets).

---

## 15. Migration and Backfill Plan

### 15.1 Migration order

```
0007_add_geofences_addresses.sql          -- new tables; cube/earthdistance ext
0008_add_cost_profiles.sql                -- cost_profiles, FKs on vehicles+sessions
0009_add_state_periods_software_versions.sql
0010_add_service_events.sql
0011_add_telemetry_session_links.sql      -- trip_id, charge_session_id columns + idx
0012_add_trip_columns.sql                 -- start/end odometer, position_ts,
                                             geofence/address FKs, power min/max,
                                             elevation_loss, inside_temp_avg,
                                             range_start/end, energy_strategy
0013_add_charge_session_columns.sql       -- energy_used_wh, avg_kw, geofence_id,
                                             address_id, cost_profile_id, cost_method
0014_add_vehicles_columns.sql             -- display_priority, cost_profile_id,
                                             home_geofence_id, firmware_version
0015_add_telemetry_unique_constraint.sql
0016_add_telemetry_spatial_idx.sql
0017_create_continuous_aggregates.sql     -- odometer_daily, etc.
0018_create_telemetry_raw_optional.sql    -- if adopted
```

### 15.2 Compatibility strategy
- All new columns NULLABLE → no application breakage.
- `cost_profile_id` resolution falls back to NULL → cost_method='unknown' (UI handles).
- Continuous aggregates: refresh policy schedules itself; first refresh covers historical data.

### 15.3 Backfill scripts (one-shot Rust binaries in `apps/api/src/bin/`)

| Script | What it does |
|---|---|
| `backfill_trip_ids` | Populate `telemetry.trip_id` for all closed trips |
| `backfill_charge_session_ids` | Same for charges |
| `backfill_trip_odometer_endpoints` | Look up `odometer_miles` at trip boundaries |
| `backfill_state_periods` | Run-length encode `telemetry.power_state` |
| `backfill_software_versions` | RLE `ota_current_version` |
| `backfill_geofence_matches` | After user creates geofences, match historical trips/charges |
| `recompute_charging_costs` | After user creates cost profiles, recompute `cost_usd` |
| `recompute_trip_energy` | Run new ranked-ensemble energy strategy on historical trips |

### 15.4 What cannot be backfilled
- `energy_used_wh` (charging integrated): requires `power_kw` samples — only available after migration 0002 was applied. For pre-0002 charges, use `energy_added_wh` only.
- `inside_temp_avg_c`: only if `cabin_temp_c` was captured (after migration 0002).
- Geofence matches for trips outside any user-defined geofence: just leave NULL.

### 15.5 Validation queries
```sql
-- trips with mismatched odometer delta
SELECT id, distance_miles, end_odometer_mi - start_odometer_mi AS odo_delta
  FROM trips WHERE ABS(distance_miles - (end_odometer_mi - start_odometer_mi)) > 0.5;

-- charge sessions without ended_at older than 6h
SELECT id FROM charge_sessions
 WHERE ended_at IS NULL AND started_at < NOW() - INTERVAL '6 hours';

-- telemetry rows post-detector that have trip_id NULL but power_state='drive'
SELECT COUNT(*) FROM telemetry
 WHERE power_state='drive' AND trip_id IS NULL AND ts > NOW() - INTERVAL '30 days';
```

### 15.6 Rollback
- All migrations are additive. Drop new columns/tables in reverse order if needed.
- Cleanup of denormalized fields (`trip_id`, `charge_session_id`) is safe (no other dependency).

---

## 16. Testing Plan

### 16.1 Unit tests (Rust, `cargo test`)
- `trip_detector::tests`:
  - normal drive (P → D → P)
  - short drive (< 1min) — should still emit
  - GPS gap during drive — distance must use odometer delta
  - false start (D → P within 5s) — should suppress
  - reboot mid-drive — must close existing trip on detector restart
- `charge_detector::tests`:
  - home AC charge, complete
  - DCFC charge, complete
  - interrupted charge (Connected → Disconnected without Charging)
  - charging then unplugged then re-plugged — two sessions
- `services::cost::compute_cost::tests`:
  - per_kwh, per_minute, free, flat, with/without session_fee
  - missing energy_used_wh — fall back to energy_added_wh
- `services::geofences::match_point::tests`:
  - point inside one geofence
  - point inside multiple → returns nearest
  - point outside all → None
- `services::idle_drain::filter::tests`:
  - excludes period with sub-zero outside temp
  - excludes period with hvac_active sample
- Energy strategy ensemble:
  - SOC delta ≥ 1% → strategy #1
  - SOC delta < 1%, range delta ≥ 1mi → #2
  - both small → #3

### 16.2 Integration tests (testcontainers + Postgres + Timescale)
- Migration apply + rollback
- Continuous aggregate refresh produces expected rows
- `INSERT ... ON CONFLICT` deduplication works
- Backfill scripts on synthetic 30-day fixture

### 16.3 API snapshot tests
For each new endpoint, freeze JSON shape against fixture data.

### 16.4 Frontend tests (Vitest + RTL)
- DashboardRenderer renders empty / loading / loaded states
- Each new chart component renders fixture data without error
- Geofence editor: draw-circle, save, delete

### 16.5 E2E (Playwright)
- Login → Overview dashboard renders all tiles
- Drives list → click → detail map renders
- Create geofence at home → mark trip ending there
- Add cost profile → Cost dashboard reflects new totals
- Date range change → all charts refresh

### 16.6 Edge-case fixtures (seed in `apps/api/tests/fixtures/`)
- normal_drive.json
- short_drive.json
- gps_gap_drive.json
- home_ac_charge.json
- public_dcfc_charge.json
- interrupted_charge.json
- vehicle_asleep_72h.json
- soc_drop_while_parked.json
- duplicate_snapshots.json
- midnight_crossing_trip.json
- multi_vehicle.json

---

## 17. Performance Plan

### 17.1 Indexes (in addition to existing)
- `telemetry (vehicle_id, trip_id, ts)` partial WHERE `trip_id IS NOT NULL`
- `telemetry (vehicle_id, charge_session_id, ts)` partial
- `telemetry` GIST `ll_to_earth(latitude,longitude)` partial WHERE not null
- `geofences` GIST `ll_to_earth(latitude,longitude)`
- `trips (vehicle_id, started_at DESC)` (exists)
- `charge_sessions (vehicle_id, started_at DESC)` (exists)
- `trips (start_geofence_id)`, `trips (end_geofence_id)`
- `charge_sessions (geofence_id)`

### 17.2 Query optimization
- Always include `vehicle_id` in WHERE — TimescaleDB's space partition.
- Use `time_bucket()` instead of `date_trunc()` on hypertable (uses chunk metadata).
- For "last 24h" widgets, Postgres planner picks recent chunk via constraint exclusion.

### 17.3 Partitioning
- `telemetry` already a hypertable, chunked by 1 week. **Verify chunk count < 1000** in long-lived deployments — otherwise increase to 1 month.
- `vehicle_state_periods`: not big enough to need partitioning.

### 17.4 Materialization
- Continuous aggregates: `odometer_daily`, possibly `soc_hourly` for fast SOC charts at long ranges.
- Standard matviews refreshed nightly: `efficiency_daily`, `charging_daily`.

### 17.5 Caching (Redis)
- Overview endpoint: 30s
- Daily aggregates endpoints: 10min
- Static dashboard configs: 5min
- Live status: bypass cache (always fresh)

### 17.6 Pagination
- All list endpoints cursor-based on (started_at, id) tuple.

### 17.7 Map data simplification
- Server-side: Douglas–Peucker on `track` endpoint when > 1000 points; tolerance scales with date range.
- Client: cluster markers on heatmap.

### 17.8 Retention
- `telemetry`: compress chunks > 30 days.
- `telemetry_raw`: drop > 30 days.
- `vehicle_state_periods`: indefinite (small).
- Daily aggregates: indefinite.

---

## 18. Privacy & Local-First Considerations

### 18.1 GPS storage
- Stored at full precision (necessary for routing).
- Optional setting: `user_preferences.coarse_location_outside_home` — when set, lat/lon outside home geofence rounded to 0.01° (~1km) for export and screenshot views.

### 18.2 Geofence privacy
- Geofences are per-user; never shared between users.
- UI offers "mask home location in screenshots" toggle that blurs map area within home geofence radius.

### 18.3 Local-only deployment
- Riviamigo is self-hosted; no telemetry leaves the user's host.
- **Avoid Nominatim by default**: don't reverse-geocode automatically. Show "Address (resolve?)" link that opt-in fetches; cache result in `addresses` table.

### 18.4 Anonymization for support exports
- `apps/api/src/bin/export_anonymized` — strips lat/lon, vin, names, replaces with hashes. Useful for issue reports.

### 18.5 Delete vehicle data
- `DELETE /v1/vehicles/:id` cascades to `trips`, `charge_sessions`, `vehicle_state_periods`, `software_versions`, etc. via `ON DELETE CASCADE`. Telemetry rows: explicit DELETE (no FK from hypertable).

### 18.6 Mask in demos
- Screenshots: setting toggles a transform that recenters the home location to a fake location.

---

## 19. Execution Roadmap

### Phase 1: TeslaMate research and schema gap confirmation
- **Objective**: align on this document; no code changes.
- **Tasks**: review with project owner; lock priorities.
- **Acceptance**: signed-off plan.

### Phase 2: Raw telemetry audit
- **Objective**: confirm current `telemetry` field coverage for all targeted dashboards.
- **Tasks**: run `GET /v1/vehicles/:id/raw-data`; verify nulls per field; document in `docs/dashboard-data-map.md`.
- **Files**: `apps/api/src/routes/live.rs`, `docs/dashboard-data-map.md`.
- **Acceptance**: per-field coverage matrix populated; missing fields filed as issues.

### Phase 3: Schema migrations
- **Objective**: land migrations 0007–0017 (Section 15).
- **Tasks**: write SQL, add Rust models, update query types.
- **Files**: `apps/api/migrations/000{7..17}_*.sql`, `apps/api/src/models/{geofence,cost_profile,state_period,...}.rs`.
- **Dependencies**: Phase 1.
- **Acceptance**: all migrations apply on a fresh DB and on a populated dev DB; cargo build green.

### Phase 4: Drive/session derivation engine
- **Objective**: populate `telemetry.trip_id`, `charge_session_id` going forward + backfill.
- **Tasks**: extend `trip_detector.rs` and `charge_detector.rs` to write the FK at insert time; build `bin/backfill_trip_ids` and `bin/backfill_charge_session_ids`.
- **Files**: `apps/api/src/ingestion/{trip_detector,charge_detector,worker}.rs`, `apps/api/src/bin/backfill_*.rs`.
- **Acceptance**: 99%+ of last-30-day telemetry rows have a non-null trip_id or charge_session_id when in `drive`/`charging` state.

### Phase 5: Charging derivation engine
- **Objective**: integrated `energy_used_wh`, classify `charger_type`, compute `cost_usd` via cost profiles.
- **Tasks**: implement `services::charging::compute_*`, `services::cost::resolve_profile`, run `bin/recompute_charging_costs`.
- **Files**: `apps/api/src/services/{charging,cost}.rs`, `apps/api/src/ingestion/charge_detector.rs`.
- **Acceptance**: every closed session has either a non-null cost or `cost_method='unknown'`; energy_used_wh populated for sessions post-migration-0002.

### Phase 6: Overview dashboard
- **Objective**: live overview with all tiles in Section 10.1.
- **Tasks**: `GET /v1/dashboard/overview/:vid`; widgets `stat.live_*`, `chart.soc_24h`, `card.last_*`, `strip.state_timeline`; seed default `overview` dashboard config.
- **Files**: `apps/api/src/routes/dashboard.rs` (new), `packages/dashboards/src/widgets/overview/*`, `packages/hooks/src/useOverview.ts`.
- **Acceptance**: all tiles render; loading/empty/error states verified; mobile responsive.

### Phase 7: Drives dashboard
- **Tasks**: list, detail, track/speed/elevation/power; `MapTrackChart` component; Douglas–Peucker on server.
- **Files**: `apps/api/src/routes/drives.rs`, `packages/ui/src/charts/MapTrackChart.tsx`, etc.
- **Acceptance**: trip detail page renders end-to-end; map handles 24h trips.

### Phase 8: Charging dashboard + Cost dashboard
- **Tasks**: cost-profiles CRUD UI; geofence CRUD; recompute button; AC/DC and home/public splits.
- **Files**: `apps/web/src/routes/{charging,costs,locations}.tsx`, `packages/ui/src/charts/ChargeCurveChart.tsx`.
- **Acceptance**: home_ac_charge fixture session shows correct cost; UI prompts for missing profiles.

### Phase 9: Efficiency / Battery / Idle Drain dashboards
- **Tasks**: by-mode, by-speed, vs-temp (extend existing), degradation view, idle-drain endpoint with temp filter.
- **Files**: `apps/api/src/routes/{efficiency,battery,idle_drain}.rs`.
- **Acceptance**: idle drain matches phantom_drain fixture within 0.1%.

### Phase 10: Location / Vehicle Health dashboards
- **Tasks**: visited heatmap, geofence editor, tire pressure trends, software_versions display.
- **Files**: `packages/ui/src/charts/{MapHeatmap,GeofenceEditorMap,TirePressureGaugeQuad}.tsx`.
- **Acceptance**: heatmap renders 30 days at < 2s; geofence draw-circle saves and triggers backfill.

### Phase 11: Data Quality dashboard
- **Tasks**: completeness score, polling gaps chart.
- **Acceptance**: data_quality endpoint returns score; chart highlights gap > 5min.

### Phase 12: Polish, testing, documentation
- **Tasks**: e2e Playwright suite; storybook for new components; user docs in `docs/`.
- **Acceptance**: CI green; no Storybook a11y violations.

---

## 20. Agent Task Breakdown

Each task is dependency-aware. IDs prefixed with phase number.

### T3.1 — Geofences + addresses migration
- **Context**: see Section 8.3
- **Files to create**: `apps/api/migrations/0007_add_geofences_addresses.sql`, `apps/api/src/models/geofence.rs`, `apps/api/src/models/address.rs`
- **Steps**: write SQL with `cube`/`earthdistance` extensions; add Rust models with `sqlx::FromRow`; add `apps/api/src/routes/geofences.rs` skeleton (list/create/update/delete).
- **Tests**: unit tests for `services::geofences::match_point` (3 cases); integration test for migration apply.
- **Acceptance**: `cargo test`, `cargo sqlx prepare` green; manual `POST /v1/geofences` succeeds.

### T3.2 — Cost profiles migration
- **Files**: `apps/api/migrations/0008_add_cost_profiles.sql`, `apps/api/src/models/cost_profile.rs`, `apps/api/src/routes/cost_profiles.rs`.
- **Steps**: schema per Section 8.3; CRUD route; tie to `vehicles.cost_profile_id` and `geofences.cost_profile_id`.
- **Tests**: unit tests for `compute_cost` (per_kwh, per_minute, free, flat).
- **Acceptance**: CRUD works.

### T3.3 — Vehicle state periods + software versions migration
- **Files**: `apps/api/migrations/0009_add_state_periods_software_versions.sql`, models, `apps/api/src/jobs/materialize_state_periods_job.rs`.
- **Steps**: tables + close-on-transition logic in worker.
- **Acceptance**: opening/closing periods on a synthetic stream.

### T3.4 — Telemetry session-id link migration
- **Files**: `apps/api/migrations/0011_add_telemetry_session_links.sql`.
- **Steps**: add `trip_id`, `charge_session_id` columns + indexes.
- **Acceptance**: column present; queries that JOIN on these are <50ms p95.

### T3.5 — Trip / charge_session column extensions
- **Files**: `apps/api/migrations/0012_add_trip_columns.sql`, `0013_add_charge_session_columns.sql`.
- **Acceptance**: existing API responses unchanged (new columns NULL initially).

### T3.6 — Telemetry uniqueness + spatial index
- **Files**: `apps/api/migrations/0015_add_telemetry_unique_constraint.sql`, `0016_add_telemetry_spatial_idx.sql`.
- **Steps**: add UNIQUE `(vehicle_id, ts)` (note hypertable constraints), GIST `ll_to_earth(latitude, longitude)`.
- **Acceptance**: dup INSERTs rejected (or `ON CONFLICT DO NOTHING` works); spatial query < 100ms.

### T3.7 — Continuous aggregates
- **Files**: `apps/api/migrations/0017_create_continuous_aggregates.sql`.
- **Steps**: create `odometer_daily` CAGG; refresh policy.
- **Acceptance**: CAGG returns expected daily values for fixture.

### T4.1 — Trip detector writes `trip_id`
- **Files**: `apps/api/src/ingestion/{trip_detector,worker}.rs`.
- **Steps**: when in Driving state, every inserted telemetry row carries `trip_id` of the open trip.
- **Tests**: extend trip_detector tests; verify telemetry rows linked.
- **Acceptance**: live telemetry shows non-null `trip_id` while driving.

### T4.2 — Charge detector writes `charge_session_id`
- Mirror of T4.1 for charging.

### T4.3 — Backfill historical trip/charge IDs
- **Files**: `apps/api/src/bin/backfill_trip_ids.rs`, `apps/api/src/bin/backfill_charge_session_ids.rs`.
- **Steps**: iterate closed sessions; UPDATE telemetry by time range.
- **Acceptance**: post-run, > 99% expected rows linked.

### T4.4 — Trip odometer-endpoint backfill
- **Files**: `apps/api/src/bin/backfill_trip_odometer_endpoints.rs`.
- **Acceptance**: trip distance ≈ end-start odometer (within 0.5mi).

### T4.5 — Energy strategy ensemble
- **Files**: `apps/api/src/services/trips.rs`, ingestion close-trip path.
- **Steps**: implement ranked ensemble (Section 11.3) and write `energy_strategy`.
- **Tests**: 3 strategy tests with fixtures.
- **Acceptance**: every trip has non-null `energy_wh` and `energy_strategy`.

### T5.1 — Charging energy_used_wh integration
- **Files**: `apps/api/src/services/charging.rs`.
- **Steps**: integrate `|power_kw|*Δt` over session telemetry on close.
- **Tests**: unit test against synthetic 30s-sample charge curve.
- **Acceptance**: matches reported energy_added within 5% on home AC fixture.

### T5.2 — Charger type classifier
- **Files**: `apps/api/src/ingestion/charge_detector.rs`.
- **Steps**: classify on close based on max power_kw + chargerStatus.
- **Acceptance**: home_ac_charge → 'ac', public_dcfc_charge → 'dc'.

### T5.3 — Cost profile resolution + recompute
- **Files**: `apps/api/src/services/cost.rs`, `apps/api/src/bin/recompute_charging_costs.rs`.
- **Steps**: resolve geofence → cost_profile → vehicle default; mark unknown.
- **Acceptance**: after creating home cost_profile, all home charges have cost_usd > 0.

### T6.1 — Overview endpoint + widgets
- **Files**: `apps/api/src/routes/dashboard.rs`, `packages/dashboards/src/widgets/overview/*`, `packages/hooks/src/useOverview.ts`.
- **Acceptance**: tiles render with live data; cache hits in Redis.

### T6.2 — State timeline strip widget
- **Files**: `packages/ui/src/charts/StateTimelineStrip.tsx`, `apps/api/src/routes/state_timeline.rs`.
- **Acceptance**: 24h strip renders with correct state colors.

### T7.1 — Drives list endpoint + page
### T7.2 — Drive detail (track/speed/elevation/power)
### T7.3 — MapTrackChart with Douglas-Peucker

### T8.1 — Charging session list/detail extended
### T8.2 — ChargeCurveChart kw-vs-soc
### T8.3 — Cost profiles UI + Cost dashboard
### T8.4 — Geofence editor UI

### T9.1 — Efficiency by-speed and by-mode endpoints
### T9.2 — Battery degradation view
### T9.3 — Idle drain temp filter + dashboard

### T10.1 — Visited heatmap
### T10.2 — Top destinations table
### T10.3 — Tire pressure trend
### T10.4 — Vehicle Health dashboard

### T11.1 — Data Quality endpoint + dashboard

### T12.1 — E2E Playwright
### T12.2 — Storybook coverage
### T12.3 — User docs

---

## 21. Open Questions / Risks

### R1: Does Rivian expose exact energy consumed per drive?
- **Impact**: HIGH — drives entire energy/efficiency story.
- **Mitigation**: ranked ensemble (Section 11.3); always show strategy in tooltip.
- **Decision**: implement ensemble; revisit if Rivian adds direct field.

### R2: SOC precision sufficient for short trips?
- **Impact**: MEDIUM — 1% SOC quantization → ~1 kWh resolution on a 130 kWh pack.
- **Mitigation**: fall back to range delta (#2) when SOC delta < 1%.
- **Decision**: documented; UI shows "low confidence" badge for short trips.

### R3: Is `power_state='sleep'` exposed consistently?
- **Impact**: MEDIUM — drives idle-drain detection.
- **Mitigation**: derive sleep from `is_online=false AND last gear='P' AND charger_state='Disconnected'` if `power_state` unreliable.
- **Decision**: keep current scheme; add diagnostic in Data Quality dashboard.

### R4: Is GPS available while parked?
- **Impact**: LOW — map visualization gap.
- **Mitigation**: use last known position when telemetry GPS is null.
- **Decision**: documented in Map widget.

### R5: Charging power sampled frequently enough for integration?
- **Impact**: HIGH — affects `energy_used_wh` accuracy.
- **Current**: 30s polling cadence during charging (per `poller.rs`).
- **Mitigation**: at 30s, error on a 100kW DCFC ramp is ~3% — acceptable. Document.
- **Decision**: keep 30s; consider WS-only push if Rivian exposes power changes.

### R6: Historical data sufficient for backfill?
- **Impact**: MEDIUM — depends on user's Riviamigo install date.
- **Mitigation**: backfill only what's available; mark older trips/charges with `energy_strategy='legacy'`.

### R7: Rivian API rate limits constrain polling?
- **Impact**: LOW (currently — WS push).
- **Mitigation**: monitor 429s in `worker_health_msg`; surface in Data Quality.

### R8: Pack capacity user-configurable?
- **Impact**: MEDIUM — affects degradation calc.
- **Mitigation**: `vehicles.battery_capacity_wh` is set from telemetry; expose override field; pull from spec table by `model+battery_config` as fallback.
- **Decision**: add an admin override.

### R9: Charging power sign convention in Rivian telemetry
- **Impact**: HIGH — wrong sign → negative cost or zero energy.
- **Mitigation**: write a migration-time test that asserts `power_kw < 0` during a known charge fixture.
- **Decision**: must verify in `parser.rs` and pin with a golden test before T5.1 lands.

### R10: Reverse geocoding privacy
- **Impact**: LOW.
- **Mitigation**: opt-in only; default off (Section 18).

---

## 22. Appendix

### A. TeslaMate files referenced (full list)

```
priv/repo/migrations/20190330150000_create_car.exs
priv/repo/migrations/20190330160000_create_trips.exs (renamed → drives later)
priv/repo/migrations/20190330170000_create_positions.exs
priv/repo/migrations/20190330180000_create_states.exs
priv/repo/migrations/20190330190000_create_charging_processes.exs
priv/repo/migrations/20190330200000_create_charges.exs
priv/repo/migrations/20190408203117_create_updates.exs
priv/repo/migrations/20190415130006_create_addresses.exs
priv/repo/migrations/20190729142656_add_conversion_functions.exs
priv/repo/migrations/20190810151901_create_geofences.exs
priv/repo/migrations/20190913165850_add_range_enum.exs
priv/repo/migrations/20191003130650_add_start_and_end_position_to_drives.exs
priv/repo/migrations/20191017003836_add_est_total_charge_energy.exs
priv/repo/migrations/20191026185642_calculate_charge_energy_used.exs
priv/repo/migrations/20200103073606_add_usable_battery_level.exs
priv/repo/migrations/20200203180529_location_based_charge_cost.exs
priv/repo/migrations/20200528163852_cost_by_minute.exs
priv/repo/migrations/20220617170400_add_tire_pressures.exs
lib/teslamate/log.ex
lib/teslamate/log/{car,position,drive,charging_process,charge,state,update}.ex
lib/teslamate/locations.ex
lib/teslamate/vehicles/vehicle.ex
lib/teslamate/custom_expressions.ex
grafana/dashboards/{overview,drives,drive-stats,charges,charging-stats,
                   efficiency,vampire-drain,visited,mileage,projected-range,
                   statistics,states,trip,updates,battery-health}.json
```

### B. Important SQL snippets

**Charge energy integration** (TeslaMate, `20191026185642`):
```sql
CASE WHEN charger_phases IS NULL THEN charger_power
     ELSE charger_actual_current * charger_voltage * charger_phases / 1000.0
END
* EXTRACT(epoch FROM (date - LAG(date) OVER (ORDER BY date))) / 3600
```
**Riviamigo adaptation** (no phases):
```sql
ABS(power_kw) * EXTRACT(epoch FROM (ts - LAG(ts) OVER (ORDER BY ts))) / 3600
```

**Vampire drain pattern** (TeslaMate adapted):
```sql
WITH events AS (
  SELECT ended_at AS t_start, ... FROM trips
  UNION ALL
  SELECT ended_at AS t_start, ... FROM charge_sessions
),
gaps AS (
  SELECT t_start,
         LEAD(...) OVER (PARTITION BY vehicle_id ORDER BY t_start) AS t_end,
         soc_at_t_start - soc_at_t_end AS soc_lost,
         EXTRACT(epoch FROM (t_end - t_start))/3600 AS hours
  FROM events)
SELECT vehicle_id, AVG(soc_lost / hours) AS drain_pct_per_hour
  FROM gaps WHERE hours > 1 AND moved_distance < 0.5 ...;
```

**Geofence point-in-radius** (Riviamigo):
```sql
SELECT g.id FROM geofences g
 WHERE g.user_id = $1
   AND earth_box(ll_to_earth(g.latitude, g.longitude), g.radius_m)
       @> ll_to_earth($2, $3)
   AND earth_distance(ll_to_earth(g.latitude, g.longitude),
                       ll_to_earth($2, $3)) <= g.radius_m
 ORDER BY earth_distance(...) ASC LIMIT 1;
```

### C. Example API responses

**`GET /v1/dashboard/overview/:vid`**:
```json
{
  "data": {
    "vehicle": { "id": "uuid", "name": "Daphne", "model": "R1S" },
    "live": {
      "power_state": "sleep",
      "is_online": true,
      "battery_level": 73,
      "range_miles": 235,
      "latitude": 39.74, "longitude": -104.99,
      "last_event_at": "2026-04-30T12:40:00Z"
    },
    "today": {
      "miles_driven": 47.2,
      "drives": 3,
      "kwh_charged": 0,
      "wh_per_mile": 478
    },
    "last_drive": {
      "id": "uuid", "started_at": "...", "ended_at": "...",
      "distance_mi": 18.4, "energy_wh": 9100, "wh_per_mile": 494,
      "end_geofence": "Home"
    },
    "last_charge": {
      "id": "uuid", "started_at": "...", "ended_at": "...",
      "kwh_added": 24.5, "cost_usd": 3.18, "is_home": true,
      "charger_type": "ac"
    },
    "state_timeline_24h": [
      { "state": "sleep", "from": "...", "to": "..." },
      { "state": "drive", "from": "...", "to": "..." },
      ...
    ]
  }
}
```

### D. Pseudocode index
- Drive detection — Section 14.2
- Charging detection — Section 14.2
- Daily odometer delta — Section 14.2
- Idle drain — Section 14.2
- Geofence matching — Section 14.2
- Backfill trip_ids — Section 14.3

### E. Terminology
- **SOC**: State of Charge (battery %).
- **DCFC**: DC Fast Charging.
- **RAN**: Rivian Adventure Network.
- **CAGG**: TimescaleDB Continuous Aggregate.
- **Phantom drain / vampire drain**: SOC loss while parked.
- **Geofence**: a circle (lat/lon + radius) in user space; matched against position points.
- **Cost profile**: a billing rule (per kWh, per minute, free, flat).
- **Energy strategy**: the chosen method (#1/#2/#3) for estimating drive energy.

---

*End of plan.*
