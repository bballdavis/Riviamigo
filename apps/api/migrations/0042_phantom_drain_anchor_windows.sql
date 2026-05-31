-- Rebuild phantom drain views to use TeslaMate-style anchor windows.
--
-- Previous logic segmented telemetry runs on power_state IN ('sleep','ready').
-- That can miss valid parked drain windows when Rivian reports sparse or
-- non-sleep/ready states. This migration derives idle windows from gaps between
-- adjacent trip/charge anchors, then computes SoC loss inside each gap.
--
-- Parity-oriented rules:
--   * window = [previous anchor end, next anchor start)
--   * minimum window duration: 15 minutes
--   * require SoC decrease (soc_start > soc_end)
--   * exclude windows with >= 1 mile odometer movement (not truly idle)

DROP VIEW IF EXISTS timeseries.phantom_drain_daily CASCADE;
DROP VIEW IF EXISTS timeseries.phantom_drain_periods CASCADE;

CREATE VIEW timeseries.phantom_drain_periods AS
WITH anchors AS (
  SELECT DISTINCT
    vehicle_id,
    started_at AS start_date,
    ended_at AS end_date
  FROM riviamigo.trips
  WHERE started_at IS NOT NULL
    AND ended_at IS NOT NULL
    AND ended_at >= started_at
    AND started_at >= NOW() - INTERVAL '366 days'

  UNION

  SELECT DISTINCT
    vehicle_id,
    started_at AS start_date,
    ended_at AS end_date
  FROM riviamigo.charge_sessions
  WHERE started_at IS NOT NULL
    AND ended_at IS NOT NULL
    AND ended_at >= started_at
    AND started_at >= NOW() - INTERVAL '366 days'
),
gaps AS (
  SELECT
    vehicle_id,
    LAG(end_date) OVER (PARTITION BY vehicle_id ORDER BY start_date, end_date) AS period_start,
    start_date AS period_end
  FROM anchors
),
candidate_periods AS (
  SELECT
    vehicle_id,
    period_start,
    period_end,
    EXTRACT(EPOCH FROM (period_end - period_start)) / 3600.0 AS duration_hours
  FROM gaps
  WHERE period_start IS NOT NULL
    AND period_end > period_start
    AND period_end - period_start >= INTERVAL '15 minutes'
),
period_metrics AS (
  SELECT
    p.vehicle_id,
    p.period_start,
    p.period_end,
    p.duration_hours,
    start_soc.soc AS soc_start,
    end_soc.soc AS soc_end,
    start_odo.odo_mi AS odometer_start_mi,
    end_odo.odo_mi AS odometer_end_mi
  FROM candidate_periods p
  LEFT JOIN LATERAL (
    SELECT t.battery_level::float8 AS soc
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts >= p.period_start
      AND t.battery_level IS NOT NULL
    ORDER BY t.ts ASC
    LIMIT 1
  ) start_soc ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.battery_level::float8 AS soc
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts <= p.period_end
      AND t.battery_level IS NOT NULL
    ORDER BY t.ts DESC
    LIMIT 1
  ) end_soc ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.odometer_miles::float8 AS odo_mi
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts >= p.period_start
      AND t.odometer_miles IS NOT NULL
    ORDER BY t.ts ASC
    LIMIT 1
  ) start_odo ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.odometer_miles::float8 AS odo_mi
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts <= p.period_end
      AND t.odometer_miles IS NOT NULL
    ORDER BY t.ts DESC
    LIMIT 1
  ) end_odo ON TRUE
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  (soc_start - soc_end) AS soc_lost_pct,
  duration_hours,
  CASE
    WHEN duration_hours > 0
    THEN (soc_start - soc_end) / duration_hours
    ELSE NULL
  END AS drain_pct_per_hour
FROM period_metrics
WHERE soc_start IS NOT NULL
  AND soc_end IS NOT NULL
  AND soc_start > soc_end
  AND COALESCE(odometer_end_mi - odometer_start_mi, 0) < 1.0;

CREATE VIEW timeseries.phantom_drain_daily AS
SELECT
  vehicle_id,
  DATE(period_start) AS day,
  SUM(soc_lost_pct) AS soc_lost_pct_total,
  SUM(duration_hours) AS hours_idle,
  AVG(drain_pct_per_hour) AS avg_drain_pct_per_hour,
  COUNT(*) AS idle_period_count
FROM timeseries.phantom_drain_periods
GROUP BY vehicle_id, DATE(period_start);
