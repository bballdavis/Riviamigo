-- Distinguish "the Parallax socket received something" from "the vehicle
-- itself is still reporting". Rivian re-sends a snapshot of every topic, with
-- the original timestamps, on each subscribe; those frames advance
-- last_frame_at without the vehicle saying anything new.
ALTER TABLE riviamigo.parallax_collector_state
    ADD COLUMN IF NOT EXISTS last_vehicle_reported_at timestamptz,
    ADD COLUMN IF NOT EXISTS resubscribe_count bigint NOT NULL DEFAULT 0;
