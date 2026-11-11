-- Vehicle status derives the nose direction (`facing_deg`) from recent
-- drive/reverse shifts and the bearings around them. Without these indexes
-- the shift lookup walks up to 30 days of a vehicle's telemetry backwards on
-- every status read. Each predicate matches the one in
-- `services/vehicle_facing.rs` exactly, so the planner can use the partial
-- index. Creating an index on the hypertable also creates it on every chunk.
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_motion_gear_ts
    ON timeseries.telemetry (vehicle_id, ts DESC)
    WHERE lower(gear_status) IN ('drive', 'reverse');

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_heading_ts
    ON timeseries.telemetry (vehicle_id, ts DESC)
    WHERE heading_deg IS NOT NULL;
