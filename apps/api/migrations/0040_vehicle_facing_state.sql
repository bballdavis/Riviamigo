-- Vehicle status reports which way a parked vehicle's nose points
-- (`facing_deg`). Working that out reads back through recent drive/reverse
-- telemetry, so the answer is saved with the vehicle's latest state and
-- reused until new telemetry could change it.
--
-- `facing_reversed`: whether the current bearing is a reverse course (the
-- vehicle backed into position). NULL until it is worked out again.
-- `facing_epoch`: bumped by ingestion after it stores telemetry that could
-- change the answer. A status read saves its answer only if the epoch is
-- unchanged, so a read that raced with new telemetry cannot save a stale one.
--
-- Both are new columns on a one-row-per-vehicle table; the constant default
-- does not rewrite the table.
ALTER TABLE riviamigo.vehicle_latest_status
    ADD COLUMN IF NOT EXISTS facing_reversed boolean,
    ADD COLUMN IF NOT EXISTS facing_epoch bigint NOT NULL DEFAULT 0;
