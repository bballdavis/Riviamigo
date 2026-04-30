-- Denormalize trip_id and charge_session_id onto every telemetry row.
-- This transforms O(time-window scan) trip-point queries into
-- O(index lookup on trip_id), which is critical for route rendering
-- and per-trip power/speed profiles at scale.
--
-- The ingestion worker sets these FKs at INSERT time going forward.
-- Historical rows are backfilled via bin/backfill_trip_ids and
-- bin/backfill_charge_session_ids.
ALTER TABLE timeseries.telemetry
  ADD COLUMN IF NOT EXISTS trip_id           UUID,
  ADD COLUMN IF NOT EXISTS charge_session_id UUID;

-- Partial indexes: only rows that belong to a session pay the index cost.
CREATE INDEX IF NOT EXISTS telemetry_trip_idx
  ON timeseries.telemetry (trip_id, ts)
  WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS telemetry_charge_idx
  ON timeseries.telemetry (charge_session_id, ts)
  WHERE charge_session_id IS NOT NULL;
