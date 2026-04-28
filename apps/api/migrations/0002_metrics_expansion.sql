-- Expand telemetry with power, climate, heading, tire pressure
ALTER TABLE timeseries.telemetry
  ADD COLUMN IF NOT EXISTS heading_deg         FLOAT8,
  ADD COLUMN IF NOT EXISTS outside_temp_c      FLOAT8,
  ADD COLUMN IF NOT EXISTS hvac_active         BOOLEAN,
  ADD COLUMN IF NOT EXISTS power_kw            FLOAT8,
  ADD COLUMN IF NOT EXISTS regen_power_kw      FLOAT8,
  ADD COLUMN IF NOT EXISTS tire_fl_psi         FLOAT8,
  ADD COLUMN IF NOT EXISTS tire_fr_psi         FLOAT8,
  ADD COLUMN IF NOT EXISTS tire_rl_psi         FLOAT8,
  ADD COLUMN IF NOT EXISTS tire_rr_psi         FLOAT8;

-- Expand trips with aggregate metrics not yet tracked
ALTER TABLE riviamigo.trips
  ADD COLUMN IF NOT EXISTS avg_speed_mph   FLOAT8,
  ADD COLUMN IF NOT EXISTS energy_wh       FLOAT8,
  ADD COLUMN IF NOT EXISTS regen_wh        FLOAT8,
  ADD COLUMN IF NOT EXISTS elevation_gain_m FLOAT8;

-- Charge sessions: store outside temp at start for efficiency correlation
ALTER TABLE riviamigo.charge_sessions
  ADD COLUMN IF NOT EXISTS outside_temp_c  FLOAT8,
  ADD COLUMN IF NOT EXISTS energy_added_wh FLOAT8;

-- Capacity snapshots: track battery degradation over time
CREATE TABLE IF NOT EXISTS riviamigo.battery_capacity_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  snapshotted_at TIMESTAMPTZ NOT NULL,
  odometer_mi   FLOAT8,
  usable_kwh    FLOAT8      NOT NULL,
  rated_kwh     FLOAT8,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capacity_snapshots_vehicle_ts
  ON riviamigo.battery_capacity_snapshots (vehicle_id, snapshotted_at DESC);

-- Updated 1-min view to include new columns
CREATE OR REPLACE VIEW timeseries.telemetry_1min AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  vehicle_id,
  avg(battery_level)           AS avg_soc,
  avg(distance_to_empty_mi)    AS avg_range_mi,
  avg(speed_mph)               AS avg_speed_mph,
  max(speed_mph)               AS max_speed_mph,
  avg(power_kw)                AS avg_power_kw,
  sum(CASE WHEN regen_power_kw < 0 THEN regen_power_kw ELSE 0 END) AS regen_kw_sum,
  avg(outside_temp_c)          AS avg_outside_temp_c,
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  last(power_state, ts)        AS power_state,
  last(charger_state, ts)      AS charger_state,
  last(drive_mode, ts)         AS drive_mode,
  last(odometer_miles, ts)     AS odometer_miles,
  max(battery_capacity_wh)     AS battery_capacity_wh,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

CREATE OR REPLACE VIEW timeseries.telemetry_1hr AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  vehicle_id,
  avg(battery_level)          AS avg_soc,
  min(battery_level)          AS min_soc,
  max(battery_level)          AS max_soc,
  avg(distance_to_empty_mi)   AS avg_range_mi,
  avg(speed_mph)               AS avg_speed_mph,
  max(speed_mph)               AS max_speed_mph,
  avg(power_kw)                AS avg_power_kw,
  avg(outside_temp_c)          AS avg_outside_temp_c,
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  max(battery_capacity_wh)     AS battery_capacity_wh,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

CREATE OR REPLACE VIEW timeseries.telemetry_1day AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  vehicle_id,
  avg(battery_level)          AS avg_soc,
  min(battery_level)          AS min_soc,
  max(battery_level)          AS max_soc,
  avg(distance_to_empty_mi)   AS avg_range_mi,
  max(battery_capacity_wh)    AS battery_capacity_wh,
  avg(cabin_temp_c)           AS avg_cabin_temp_c,
  avg(outside_temp_c)         AS avg_outside_temp_c,
  count(*)                    AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

-- Efficiency vs outside temperature (binned by 5°C)
CREATE OR REPLACE VIEW timeseries.efficiency_vs_temp AS
SELECT
  vehicle_id,
  width_bucket(outside_temp_c, -20, 45, 13) AS temp_bucket,
  round(((-20 + (width_bucket(outside_temp_c, -20, 45, 13) - 1) * 5))::numeric, 0)::int AS temp_c_low,
  round(((-20 + (width_bucket(outside_temp_c, -20, 45, 13)) * 5))::numeric, 0)::int      AS temp_c_high,
  avg(t.efficiency_wh_per_mile) AS avg_efficiency_wh_mi,
  count(*)                      AS trip_count
FROM riviamigo.trips t
WHERE t.outside_temp_c IS NOT NULL
  AND t.efficiency_wh_per_mile IS NOT NULL
GROUP BY 1, 2, 3, 4;

-- Efficiency trend: 7-day rolling average from trip data
CREATE OR REPLACE VIEW timeseries.efficiency_trend_7d AS
SELECT
  vehicle_id,
  started_at::date AS day,
  avg(efficiency_wh_per_mile) OVER (
    PARTITION BY vehicle_id
    ORDER BY started_at::date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS rolling_7d_wh_mi,
  avg(efficiency_wh_per_mile) AS day_avg_wh_mi
FROM riviamigo.trips
WHERE efficiency_wh_per_mile IS NOT NULL
GROUP BY vehicle_id, started_at::date, efficiency_wh_per_mile;
