-- Forward-only storage for in-process Parallax diagnostics and bounded
-- startup repair.  No existing primary keys are changed.
ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS pack_energy_kwh double precision,
    ADD COLUMN IF NOT EXISTS thermal_energy_kwh double precision,
    ADD COLUMN IF NOT EXISTS live_time_remaining_minutes integer;
ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS parallax_power_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_energy_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_total_energy_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_pack_energy_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_thermal_energy_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_time_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_status_observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS parallax_charger_status text,
    ADD COLUMN IF NOT EXISTS parallax_live_power_kw double precision,
    ADD COLUMN IF NOT EXISTS parallax_total_charged_kwh double precision,
    ADD COLUMN IF NOT EXISTS parallax_pack_energy_kwh double precision,
    ADD COLUMN IF NOT EXISTS parallax_thermal_energy_kwh double precision,
    ADD COLUMN IF NOT EXISTS parallax_time_remaining_minutes integer;

ALTER TABLE riviamigo.parallax_collector_state
    ADD COLUMN IF NOT EXISTS last_frame_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_meaningful_frame_at timestamptz,
    ADD COLUMN IF NOT EXISTS reconnect_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS decode_error_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS empty_frame_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ambiguity_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS owner_kind text,
    ADD COLUMN IF NOT EXISTS owner_instance_id uuid,
    ADD COLUMN IF NOT EXISTS legacy_last_frame_at timestamptz,
    ADD COLUMN IF NOT EXISTS legacy_last_meaningful_frame_at timestamptz,
    ADD COLUMN IF NOT EXISTS legacy_last_classification text,
    ADD COLUMN IF NOT EXISTS legacy_null_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_missing_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_malformed_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_all_null_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_meaningful_count bigint NOT NULL DEFAULT 0;

ALTER TABLE riviamigo.parallax_collector_state
    DROP CONSTRAINT IF EXISTS parallax_collector_state_status_check;
ALTER TABLE riviamigo.parallax_collector_state
    ADD CONSTRAINT parallax_collector_state_status_check
    CHECK (status IN ('starting','connected','reconnecting','stale','disconnected','disabled','duplicate_owner','error'));

ALTER TABLE timeseries.parallax_charge_breakdown_samples
    ADD COLUMN IF NOT EXISTS charge_session_id uuid
        REFERENCES riviamigo.charge_sessions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS riviamigo.charge_session_repair_journal (
    id bigserial PRIMARY KEY,
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    repair_key text NOT NULL,
    reason text NOT NULL,
    revision text NOT NULL,
    before_images jsonb NOT NULL DEFAULT '{}'::jsonb,
    after_images jsonb NOT NULL DEFAULT '{}'::jsonb,
    reference_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    reverted_at timestamptz,
    UNIQUE (vehicle_id, repair_key)
);

CREATE TABLE IF NOT EXISTS riviamigo.charge_session_repair_cursor (
    vehicle_id uuid PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    cursor_ts timestamptz,
    cursor_segment_index integer NOT NULL DEFAULT -1,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeseries.parallax_charge_curve_points (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    segment_index integer NOT NULL,
    charge_session_id uuid REFERENCES riviamigo.charge_sessions(id) ON DELETE SET NULL,
    power_kw double precision,
    soc double precision,
    delivered_energy_kwh double precision,
    received_at timestamptz NOT NULL DEFAULT now(),
    schema_version integer NOT NULL DEFAULT 1,
    reconciliation_checked_at timestamptz,
    PRIMARY KEY (vehicle_id, source_at, segment_index)
);

CREATE INDEX IF NOT EXISTS parallax_charge_curve_session_idx
    ON timeseries.parallax_charge_curve_points (charge_session_id, source_at)
    WHERE charge_session_id IS NOT NULL;
