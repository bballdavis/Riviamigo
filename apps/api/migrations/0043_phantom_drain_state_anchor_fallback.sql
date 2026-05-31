-- Add state-period anchor fallback for phantom drain sessionization.
--
-- 0041 switched phantom drain to trip/charge anchor windows. This migration
-- extends that model with additional anchors from closed drive/charging state
-- periods so vehicles with sparse trip/charge history still emit valid windows.

DROP VIEW IF EXISTS timeseries.phantom_drain_daily CASCADE;
DROP VIEW IF EXISTS timeseries.phantom_drain_periods CASCADE;

CREATE VIEW timeseries.phantom_drain_periods AS
WITH anchors AS (
  SELECT
    vehicle_id,
    started_at,
    ended_at,
    soc_start,
    soc_end
  FROM riviamigo.trips
  WHERE ended_at IS NOT NULL
    AND started_at >= NOW() - INTERVAL '365 days'
    AND soc_start IS NOT NULL
    AND soc_end IS NOT NULL

  UNION ALL

  SELECT
    vehicle_id,
    started_at,
    ended_at,
    soc_start,
    soc_end
  FROM riviamigo.charge_sessions
  WHERE ended_at IS NOT NULL
    AND started_at >= NOW() - INTERVAL '365 days'
    AND soc_start IS NOT NULL
    AND soc_end IS NOT NULL

  UNION ALL

  SELECT
    vehicle_id,
    started_at,
    ended_at,
    NULL::float8 AS soc_start,
    NULL::float8 AS soc_end
  FROM riviamigo.vehicle_state_periods
  WHERE ended_at IS NOT NULL
    AND started_at >= NOW() - INTERVAL '365 days'
    AND state IN ('drive', 'charging')
),
ordered AS (
  SELECT
    vehicle_id,
    started_at AS current_start,
    ended_at AS current_end,
    soc_start AS current_soc_start,
    soc_end AS current_soc_end,
    LAG(ended_at) OVER w AS prev_end,
    LAG(soc_end) OVER w AS prev_soc_end
  FROM anchors
  WINDOW w AS (PARTITION BY vehicle_id ORDER BY started_at, ended_at)
),
periods AS (
  SELECT
    vehicle_id,
    prev_end AS period_start,
    current_start AS period_end,
    prev_soc_end,
    current_soc_start
  FROM ordered
  WHERE prev_end IS NOT NULL
    AND current_start > prev_end
),
enriched AS (
  SELECT
    p.vehicle_id,
    p.period_start,
    p.period_end,
    COALESCE(p.prev_soc_end, start_sample.soc) AS soc_start,
    COALESCE(p.current_soc_start, end_sample.soc) AS soc_end
  FROM periods p
  LEFT JOIN LATERAL (
    SELECT t.battery_level::float8 AS soc
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts <= p.period_start
      AND t.battery_level IS NOT NULL
    ORDER BY t.ts DESC
    LIMIT 1
  ) start_sample ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.battery_level::float8 AS soc
    FROM timeseries.telemetry t
    WHERE t.vehicle_id = p.vehicle_id
      AND t.ts >= p.period_end
      AND t.battery_level IS NOT NULL
    ORDER BY t.ts ASC
    LIMIT 1
  ) end_sample ON TRUE
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  GREATEST(soc_start - soc_end, 0) AS soc_lost_pct,
  EXTRACT(EPOCH FROM (period_end - period_start)) / 3600.0 AS duration_hours,
  CASE
    WHEN EXTRACT(EPOCH FROM (period_end - period_start)) > 0
    THEN GREATEST(soc_start - soc_end, 0)
         / (EXTRACT(EPOCH FROM (period_end - period_start)) / 3600.0)
    ELSE NULL
  END AS drain_pct_per_hour
FROM enriched
WHERE period_end - period_start >= INTERVAL '15 minutes'
  AND soc_start IS NOT NULL
  AND soc_end IS NOT NULL
  AND soc_start >= soc_end;

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