-- Enrich charge_sessions with Rivian API fields.
-- Add charging_schedules and departure_schedules tables.

ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS network_vendor     TEXT,
    ADD COLUMN IF NOT EXISTS range_added_km     FLOAT8,
    ADD COLUMN IF NOT EXISTS is_free_session    BOOLEAN,
    ADD COLUMN IF NOT EXISTS is_rivian_network  BOOLEAN,
    ADD COLUMN IF NOT EXISTS rivian_paid_total  FLOAT8;

CREATE TABLE IF NOT EXISTS riviamigo.charging_schedules (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id          UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    enabled             BOOLEAN     NOT NULL DEFAULT false,
    start_time_minutes  INT,
    duration_minutes    INT,
    amperage            FLOAT8,
    location_lat        FLOAT8,
    location_lng        FLOAT8,
    week_days           TEXT[],
    rivian_updated_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vehicle_id)
);

CREATE TABLE IF NOT EXISTS riviamigo.departure_schedules (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id          UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    rivian_schedule_id  TEXT        NOT NULL,
    name                TEXT,
    enabled             BOOLEAN     NOT NULL DEFAULT false,
    occurrence          JSONB,
    comfort_settings    JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vehicle_id, rivian_schedule_id)
);

CREATE INDEX IF NOT EXISTS departure_schedules_vehicle_id_idx
    ON riviamigo.departure_schedules (vehicle_id);
