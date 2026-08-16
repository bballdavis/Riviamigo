-- User corrections are deliberately separate from Rivian/telemetry data.  The
-- legacy location columns remain the effective presentation location so older
-- API clients continue to work unchanged.
ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS source_location_lat double precision,
    ADD COLUMN IF NOT EXISTS source_location_lng double precision,
    ADD COLUMN IF NOT EXISTS location_override_mode text NOT NULL DEFAULT 'automatic',
    ADD COLUMN IF NOT EXISTS cost_override_mode text NOT NULL DEFAULT 'automatic',
    ADD COLUMN IF NOT EXISTS cost_override_usd double precision;

UPDATE riviamigo.charge_sessions
SET source_location_lat = COALESCE(source_location_lat, location_lat),
    source_location_lng = COALESCE(source_location_lng, location_lng)
WHERE source_location_lat IS NULL OR source_location_lng IS NULL;

ALTER TABLE riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_location_override_mode_check
        CHECK (location_override_mode IN ('automatic', 'saved_place', 'none')),
    ADD CONSTRAINT charge_sessions_cost_override_mode_check
        CHECK (cost_override_mode IN ('automatic', 'free', 'manual')),
    ADD CONSTRAINT charge_sessions_manual_cost_check
        CHECK (cost_override_mode <> 'manual' OR (cost_override_usd IS NOT NULL AND cost_override_usd >= 0)),
    ADD CONSTRAINT charge_sessions_non_manual_cost_override_check
        CHECK (cost_override_mode = 'manual' OR cost_override_usd IS NULL);

CREATE TABLE riviamigo.vehicle_charging_network_preferences (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    vendor_normalized text NOT NULL,
    network_vendor text NOT NULL,
    cost_mode text NOT NULL DEFAULT 'automatic',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, vendor_normalized),
    CONSTRAINT vehicle_charging_network_preferences_cost_mode_check
        CHECK (cost_mode IN ('automatic', 'free')),
    CONSTRAINT vehicle_charging_network_preferences_vendor_normalized_check
        CHECK (length(trim(vendor_normalized)) > 0)
);

CREATE INDEX charge_sessions_vehicle_network_vendor_idx
    ON riviamigo.charge_sessions (vehicle_id, lower(trim(network_vendor)))
    WHERE network_vendor IS NOT NULL AND trim(network_vendor) <> '';
