-- no-transaction
-- Migration 0036: Convert telemetry_1min from a plain VIEW to a TimescaleDB
-- continuous aggregate so charging-curve and TOU-readings queries are O(buckets)
-- rather than O(raw-samples).
--
-- The view has been a performance bottleneck: every call to charging curve
-- analysis or cost-recompute has scanned the full hypertable through the view.
-- A continuous aggregate materialises the 1-minute buckets and refreshes them
-- on a schedule, making reads fast regardless of deployment age.
--
-- Columns are identical to the previous view (migration 0002) so all existing
-- queries continue to work without change.

DROP VIEW IF EXISTS timeseries.telemetry_1min CASCADE;

CREATE MATERIALIZED VIEW timeseries.telemetry_1min
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 minute', ts)   AS bucket,
  vehicle_id,
  avg(battery_level)            AS avg_soc,
  avg(distance_to_empty_mi)     AS avg_range_mi,
  avg(speed_mph)                AS avg_speed_mph,
  max(speed_mph)                AS max_speed_mph,
  avg(cabin_temp_c)             AS avg_cabin_temp_c,
  last(power_state, ts)         AS power_state,
  last(charger_state, ts)       AS charger_state,
  last(drive_mode, ts)          AS drive_mode,
  last(odometer_miles, ts)      AS odometer_miles,
  max(battery_capacity_wh)      AS battery_capacity_wh,
  count(*)                      AS sample_count,
  avg(power_kw)                 AS avg_power_kw,
  sum(CASE WHEN regen_power_kw < 0 THEN regen_power_kw ELSE 0 END) AS regen_kw_sum,
  avg(outside_temp_c)           AS avg_outside_temp_c
FROM timeseries.telemetry
GROUP BY time_bucket('1 minute', ts), vehicle_id
WITH NO DATA;

-- Refresh the last 7 days every 5 minutes.
SELECT add_continuous_aggregate_policy(
  'timeseries.telemetry_1min',
  start_offset      => INTERVAL '7 days',
  end_offset        => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists     => true
);
