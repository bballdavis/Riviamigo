-- The R2 liftgate's drop glass, reported by Parallax as closure position 16.
-- Nullable with no default, so existing rows and other models are unchanged.
ALTER TABLE timeseries.telemetry
    ADD COLUMN IF NOT EXISTS window_rear_closed boolean;
ALTER TABLE riviamigo.vehicle_latest_status
    ADD COLUMN IF NOT EXISTS window_rear_closed boolean;
