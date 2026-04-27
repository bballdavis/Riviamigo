CREATE MATERIALIZED VIEW timeseries.phantom_drain_periods AS
WITH parked_segments AS (
  SELECT
    vehicle_id,
    ts,
    battery_level,
    power_state,
    LAG(battery_level) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_soc,
    LAG(ts)            OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_ts
  FROM timeseries.telemetry
  WHERE power_state = 'sleep'
),
drain_events AS (
  SELECT
    vehicle_id,
    ts               AS period_end,
    prev_ts          AS period_start,
    prev_soc         AS soc_start,
    battery_level    AS soc_end,
    (prev_soc - battery_level) AS soc_lost,
    EXTRACT(EPOCH FROM (ts - prev_ts)) / 3600.0 AS hours_elapsed
  FROM parked_segments
  WHERE prev_soc IS NOT NULL
    AND (prev_soc - battery_level) > 0
    AND EXTRACT(EPOCH FROM (ts - prev_ts)) > 300
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  soc_lost,
  hours_elapsed,
  (soc_lost / NULLIF(hours_elapsed, 0)) AS drain_rate_soc_per_hour
FROM drain_events;

CREATE UNIQUE INDEX ON timeseries.phantom_drain_periods (vehicle_id, period_start);

CREATE MATERIALIZED VIEW timeseries.phantom_drain_daily AS
SELECT
  date_trunc('day', period_start) AS day,
  vehicle_id,
  sum(soc_lost)                   AS total_soc_lost,
  sum(hours_elapsed)              AS total_hours_parked,
  avg(drain_rate_soc_per_hour)    AS avg_drain_rate,
  count(*)                        AS drain_events
FROM timeseries.phantom_drain_periods
GROUP BY 1, 2;

CREATE UNIQUE INDEX ON timeseries.phantom_drain_daily (vehicle_id, day);
