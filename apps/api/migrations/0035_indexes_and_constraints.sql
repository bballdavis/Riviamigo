-- no-transaction
-- Migration 0035: Add missing indexes and uniqueness constraints
-- Addresses:
--   • Missing partial unique index on charge_sessions for telemetry-detected sessions
--   • Missing partial unique index on vehicle_state_periods (only one open period per vehicle)
--   • Partial index on telemetry for efficient total_miles / odometer lookups (replaces full-scan)
--   • Index to accelerate latest-telemetry-per-column queries

-- Prevent duplicate home-AC sessions on ingestion retry/restart.
-- Sessions with a rivian_session_id already have a unique constraint; this covers
-- locally-detected sessions that have no Rivian session id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_sessions_vehicle_started_no_rivian
  ON riviamigo.charge_sessions (vehicle_id, started_at)
  WHERE rivian_session_id IS NULL;

-- Prevent two concurrent open state periods for the same vehicle.
-- Legacy ingestion bugs could leave multiple open rows; close all but the latest
-- open row per vehicle before enforcing uniqueness.
WITH open_rows AS (
  SELECT
    id,
    vehicle_id,
    started_at,
    lead(started_at) OVER (PARTITION BY vehicle_id ORDER BY started_at, id) AS next_open_started,
    row_number() OVER (PARTITION BY vehicle_id ORDER BY started_at DESC, id DESC) AS keep_rank
  FROM riviamigo.vehicle_state_periods
  WHERE ended_at IS NULL
)
UPDATE riviamigo.vehicle_state_periods vsp
SET ended_at = COALESCE(open_rows.next_open_started, now())
FROM open_rows
WHERE vsp.id = open_rows.id
  AND open_rows.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_state_periods_open
  ON riviamigo.vehicle_state_periods (vehicle_id)
  WHERE ended_at IS NULL;

-- Partial index to make odometer/total-miles lookups efficient without a full hypertable scan.
-- Used by metrics.rs summary_value("total_miles") and odometer_daily refresh.
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_odometer
  ON timeseries.telemetry (vehicle_id, ts DESC)
  WHERE odometer_miles IS NOT NULL;
