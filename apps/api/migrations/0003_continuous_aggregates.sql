CREATE MATERIALIZED VIEW timeseries.telemetry_1min
WITH (timescaledb.continuous) AS
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
  count(*)                      AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('timeseries.telemetry_1min',
  start_offset   => INTERVAL '2 hours',
  end_offset     => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');

CREATE MATERIALIZED VIEW timeseries.telemetry_1hr
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts)    AS bucket,
  vehicle_id,
  avg(battery_level)           AS avg_soc,
  min(battery_level)           AS min_soc,
  max(battery_level)           AS max_soc,
  avg(distance_to_empty_mi)    AS avg_range_mi,
  avg(speed_mph)               AS avg_speed_mph,
  max(speed_mph)               AS max_speed_mph,
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  max(battery_capacity_wh)     AS battery_capacity_wh,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('timeseries.telemetry_1hr',
  start_offset   => INTERVAL '3 days',
  end_offset     => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

CREATE MATERIALIZED VIEW timeseries.telemetry_1day
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts)     AS bucket,
  vehicle_id,
  avg(battery_level)           AS avg_soc,
  min(battery_level)           AS min_soc,
  max(battery_level)           AS max_soc,
  avg(distance_to_empty_mi)    AS avg_range_mi,
  max(battery_capacity_wh)     AS battery_capacity_wh,
  avg(cabin_temp_c)            AS avg_cabin_temp_c,
  count(*)                     AS sample_count
FROM timeseries.telemetry
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('timeseries.telemetry_1day',
  start_offset   => INTERVAL '7 days',
  end_offset     => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');
