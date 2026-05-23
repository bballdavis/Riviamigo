-- Add richer Rivian charging evidence while keeping existing sessions readable.

ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS rivian_charger_type        TEXT,
    ADD COLUMN IF NOT EXISTS currency_code              TEXT,
    ADD COLUMN IF NOT EXISTS rivian_city                TEXT,
    ADD COLUMN IF NOT EXISTS rivian_vehicle_id          TEXT,
    ADD COLUMN IF NOT EXISTS rivian_vehicle_name        TEXT,
    ADD COLUMN IF NOT EXISTS is_public                  BOOLEAN,
    ADD COLUMN IF NOT EXISTS rivian_meta                JSONB,
    ADD COLUMN IF NOT EXISTS charger_id                 TEXT,
    ADD COLUMN IF NOT EXISTS live_current_price         FLOAT8,
    ADD COLUMN IF NOT EXISTS live_current_currency      TEXT,
    ADD COLUMN IF NOT EXISTS live_total_charged_kwh     FLOAT8,
    ADD COLUMN IF NOT EXISTS live_range_added_km        FLOAT8,
    ADD COLUMN IF NOT EXISTS live_power_kw              FLOAT8,
    ADD COLUMN IF NOT EXISTS live_charge_rate_kph       FLOAT8,
    ADD COLUMN IF NOT EXISTS live_time_elapsed_seconds  INT,
    ADD COLUMN IF NOT EXISTS live_session_started_at    TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS riviamigo.rivian_charge_payloads (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id            UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    charge_session_id     UUID REFERENCES riviamigo.charge_sessions(id) ON DELETE SET NULL,
    operation             TEXT NOT NULL,
    rivian_transaction_id TEXT,
    rivian_vehicle_id     TEXT,
    captured_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload               JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS rivian_charge_payloads_vehicle_captured_idx
    ON riviamigo.rivian_charge_payloads (vehicle_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS rivian_charge_payloads_transaction_idx
    ON riviamigo.rivian_charge_payloads (rivian_transaction_id)
    WHERE rivian_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS riviamigo.rivian_charge_curve_points (
    vehicle_id        UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    charge_session_id UUID REFERENCES riviamigo.charge_sessions(id) ON DELETE CASCADE,
    ts                TIMESTAMPTZ NOT NULL,
    power_kw          FLOAT8,
    captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, ts)
);

CREATE INDEX IF NOT EXISTS rivian_charge_curve_points_session_idx
    ON riviamigo.rivian_charge_curve_points (charge_session_id, ts)
    WHERE charge_session_id IS NOT NULL;
