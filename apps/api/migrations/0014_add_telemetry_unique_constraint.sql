-- Add a unique constraint on (vehicle_id, ts) to enable safe
-- ON CONFLICT DO NOTHING deduplication when the WebSocket poller and the
-- REST poller deliver the same sample.
--
-- NOTE: TimescaleDB requires that unique constraints include the
-- partitioning column (ts).  vehicle_id is also required here so the
-- constraint only rejects the same vehicle at the same instant — not
-- different vehicles at the same instant.
--
-- This migration is deliberately separate from 0011 because on large
-- existing deployments the constraint build (which scans the whole table)
-- can take a long time, and operators may want to run it during a
-- maintenance window.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telemetry_unique_sample'
      AND conrelid = 'timeseries.telemetry'::regclass
  ) THEN
    ALTER TABLE timeseries.telemetry
      ADD CONSTRAINT telemetry_unique_sample UNIQUE (vehicle_id, ts);
  END IF;
END $$;
