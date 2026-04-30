-- no-transaction
-- ── odometer_daily — TimescaleDB continuous aggregate ────────────────────────
-- Tracks the daily maximum odometer reading per vehicle and the miles driven
-- each day (max - min).  Refreshed every hour, covering data from the past
-- 7 days of hypertable chunks in the real-time view.
--
-- NOTE: This CAGG is over timeseries.telemetry (a hypertable).  It can be
-- queried like a regular table and will automatically combine materialized
-- buckets with fresh hypertable data for the real-time tail.

CREATE MATERIALIZED VIEW IF NOT EXISTS timeseries.odometer_daily
  WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  time_bucket('1 day', ts)                        AS day,
  max(odometer_miles)                              AS odometer_end,
  max(odometer_miles) - min(odometer_miles)        AS miles_driven
FROM timeseries.telemetry
WHERE odometer_miles IS NOT NULL
GROUP BY vehicle_id, time_bucket('1 day', ts)
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'timeseries.odometer_daily',
  start_offset     => INTERVAL '7 days',
  end_offset       => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists    => true
);

-- ── phantom_drain_periods — view ──────────────────────────────────────────────
-- Idle drain periods derived from power_state runs of 'sleep' or 'ready'.
-- Replaces the previous unfiltered version with temperature and HVAC guards
-- per the plan spec (Section 5.15 / 11.10).
--
-- We use a run-detection pattern: a "new run" starts when power_state changes
-- from the previous row.  Each run group is a contiguous idle period.
--
-- Periods are excluded if:
--   • any sample has outside_temp_c < -5°C  (cold-soak range loss, not drain)
--   • any sample has hvac_active = true      (preconditioning, not drain)
--   • duration < 15 minutes                 (noise / brief stops)

DROP VIEW IF EXISTS timeseries.phantom_drain_periods CASCADE;
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
           battery_level, ts   -- needed for window frames; grouped rows deduplicated below
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
  AND soc_start > soc_end;  -- confirm actual loss occurred

-- ── phantom_drain_daily — view ────────────────────────────────────────────────
DROP VIEW IF EXISTS timeseries.phantom_drain_daily CASCADE;
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
