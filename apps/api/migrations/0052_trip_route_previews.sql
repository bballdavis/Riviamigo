-- Compact, immutable geometry for timeframe-wide trip maps.
-- Detailed trip telemetry remains in timeseries.telemetry.
ALTER TABLE riviamigo.trips
  ADD COLUMN IF NOT EXISTS route_preview JSONB,
  ADD COLUMN IF NOT EXISTS route_preview_version SMALLINT;

CREATE INDEX IF NOT EXISTS trips_route_preview_missing_idx
  ON riviamigo.trips (vehicle_id, started_at)
  WHERE route_preview IS NULL OR route_preview_version IS DISTINCT FROM 1;
