-- GIST spatial index over telemetry latitude/longitude.
-- Enables fast nearest-geofence lookups via earth_box / earth_distance
-- without a full table scan.
--
-- The index is partial (WHERE NOT NULL) because the majority of telemetry
-- rows from sleep/offline events have NULL lat/lon and should not bloat
-- the index.
--
-- Requires cube + earthdistance (already enabled in migration 0007).
CREATE INDEX IF NOT EXISTS telemetry_ll_idx
  ON timeseries.telemetry USING gist (ll_to_earth(latitude, longitude))
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
