-- Rebuild phantom drain periods from session anchors rather than telemetry
-- runs. TeslaMate models vampire drain as the gap between consecutive charge
-- and drive sessions, so we mirror that sessionization here instead of relying
-- on contiguous sleep/ready samples.

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
    prev_soc_end AS soc_start,
    current_soc_start AS soc_end
  FROM ordered
  WHERE prev_end IS NOT NULL
    AND current_start > prev_end
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
FROM periods
WHERE period_end - period_start >= INTERVAL '15 minutes'
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