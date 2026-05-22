-- Enrich vehicles table with metadata from getUserInfo / GetVehicleState API queries.
-- Add wallboxes table for home charger hardware.

ALTER TABLE riviamigo.vehicles
    ADD COLUMN IF NOT EXISTS interior_color          TEXT,
    ADD COLUMN IF NOT EXISTS wheel_option            TEXT,
    ADD COLUMN IF NOT EXISTS max_vehicle_power_kw    FLOAT8,
    ADD COLUMN IF NOT EXISTS charge_port_type        TEXT,
    ADD COLUMN IF NOT EXISTS battery_cell_type       TEXT,
    ADD COLUMN IF NOT EXISTS supported_features      JSONB,
    ADD COLUMN IF NOT EXISTS ota_release_notes_url   TEXT;

CREATE TABLE IF NOT EXISTS riviamigo.wallboxes (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
    rivian_wallbox_id TEXT        NOT NULL,
    name              TEXT,
    latitude          FLOAT8,
    longitude         FLOAT8,
    max_power_kw      FLOAT8,
    model             TEXT,
    serial_number     TEXT,
    firmware_version  TEXT,
    linked            BOOLEAN,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, rivian_wallbox_id)
);

CREATE INDEX IF NOT EXISTS wallboxes_user_id_idx ON riviamigo.wallboxes (user_id);
