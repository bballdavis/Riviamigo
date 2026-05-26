-- Add a time bound to the phantom_drain_periods view so TimescaleDB can prune
-- hypertable chunks.  Without ts >= NOW() - INTERVAL '365 days' in the
-- innermost CTE, every query against the view triggers a full hypertable scan
-- regardless of the period_start filter applied by callers (period_start is a
-- derived MIN(ts) that the planner cannot push through the CTE boundary).
--
-- 365 days comfortably covers both the idle_drain route (user-chosen range) and
-- the battery phantom-drain route (defaults to 90 days).  Phantom drain analysis
-- older than a year is not surfaced anywhere in the UI.
--
-- phantom_drain_daily depends on phantom_drain_periods, so both are rebuilt.

DROP VIEW IF EXISTS timeseries.phantom_drain_daily    CASCADE;
DROP VIEW IF EXISTS timeseries.phantom_drain_periods  CASCADE;

CREATE VIEW timeseries.phantom_drain_periods AS
WITH state_changes AS (
  SELECT
    vehicle_id,
    ts,
    battery_level,
    outside_temp_c,
    hvac_active,
    power_state,
    LAG(power_state) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_power_state
  FROM timeseries.telemetry
  WHERE power_state IN ('sleep', 'ready')
    AND ts >= NOW() - INTERVAL '365 days'   -- enables chunk pruning
),
runs AS (
  SELECT
    vehicle_id,
    ts,
    battery_level,
    outside_temp_c,
    hvac_active,
    SUM(
      CASE
        WHEN power_state IS DISTINCT FROM prev_power_state THEN 1
        ELSE 0
      END
    ) OVER (PARTITION BY vehicle_id ORDER BY ts) AS run_id
  FROM state_changes
),
grouped AS (
  SELECT
    vehicle_id,
    run_id,
    MIN(ts)            AS period_start,
    MAX(ts)            AS period_end,
    FIRST_VALUE(battery_level) OVER (
      PARTITION BY vehicle_id, run_id ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS soc_start,
    LAST_VALUE(battery_level)  OVER (
      PARTITION BY vehicle_id, run_id ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS soc_end,
    BOOL_OR(outside_temp_c < -5)  AS has_cold,
    BOOL_OR(hvac_active = true)   AS has_hvac
  FROM runs
  GROUP BY vehicle_id, run_id,
           battery_level, ts
),
deduped AS (
  SELECT DISTINCT ON (vehicle_id, run_id)
    vehicle_id, run_id, period_start, period_end, soc_start, soc_end, has_cold, has_hvac
  FROM grouped
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  (soc_start - soc_end)                                        AS soc_lost_pct,
  EXTRACT(EPOCH FROM (period_end - period_start)) / 3600.0     AS duration_hours,
  CASE
    WHEN EXTRACT(EPOCH FROM (period_end - period_start)) > 0
    THEN (soc_start - soc_end)
         / (EXTRACT(EPOCH FROM (period_end - period_start)) / 3600.0)
    ELSE NULL
  END                                                          AS drain_pct_per_hour
FROM deduped
WHERE period_end - period_start >= INTERVAL '15 minutes'
  AND NOT has_cold
  AND NOT has_hvac
  AND soc_start > soc_end;

CREATE VIEW timeseries.phantom_drain_daily AS
SELECT
  vehicle_id,
  DATE(period_start)                    AS day,
  SUM(soc_lost_pct)                     AS soc_lost_pct_total,
  SUM(duration_hours)                   AS hours_idle,
  AVG(drain_pct_per_hour)               AS avg_drain_pct_per_hour,
  COUNT(*)                              AS idle_period_count
FROM timeseries.phantom_drain_periods
GROUP BY vehicle_id, DATE(period_start);
