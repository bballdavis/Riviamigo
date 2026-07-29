-- Normalized, privacy-filtered telemetry produced by the optional Parallax
-- collector. The collector is a separate process and these tables are not
-- part of the canonical vehicle-state ingestion path.

CREATE TABLE riviamigo.parallax_collector_state (
    vehicle_id uuid PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'starting',
    connected_at timestamptz,
    last_event_at timestamptz,
    last_error text,
    schema_version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT parallax_collector_state_status_check
        CHECK (status IN ('starting', 'connected', 'disconnected', 'error'))
);

CREATE TABLE timeseries.parallax_network_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    overall_state integer,
    active_transport integer,
    wifi_status integer,
    wifi_connected boolean,
    wifi_rssi_dbm integer,
    wifi_link_speed_mbps integer,
    wifi_frequency_mhz integer,
    wifi_channel_width_mhz integer,
    cellular_access_technology text,
    cellular_signal_dbm integer,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash)
);
CREATE INDEX parallax_network_vehicle_source_idx
    ON timeseries.parallax_network_samples (vehicle_id, source_at DESC);

CREATE TABLE timeseries.parallax_efficiency_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    reference_wh_per_km integer,
    learned_wh_per_km integer,
    mode_ranges_km jsonb NOT NULL DEFAULT '{}'::jsonb,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash)
);
CREATE INDEX parallax_efficiency_vehicle_source_idx
    ON timeseries.parallax_efficiency_samples (vehicle_id, source_at DESC);

CREATE TABLE timeseries.parallax_mass_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    estimated_mass_kg integer NOT NULL,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash)
);
CREATE INDEX parallax_mass_vehicle_source_idx
    ON timeseries.parallax_mass_samples (vehicle_id, source_at DESC);

CREATE TABLE timeseries.parallax_parked_energy_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    period_window text NOT NULL,
    parked_started_at timestamptz,
    duration_minutes integer,
    total_kwh double precision,
    vehicle_systems_kwh double precision,
    outlets_kwh double precision,
    climate_kwh double precision,
    gear_guard_kwh double precision,
    total_range_impact_km double precision,
    vehicle_systems_range_impact_km double precision,
    outlets_range_impact_km double precision,
    climate_range_impact_km double precision,
    gear_guard_range_impact_km double precision,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash, period_window),
    CONSTRAINT parallax_parked_energy_window_check
        CHECK (period_window IN ('24h', '8h', 'since_parked'))
);
CREATE INDEX parallax_parked_energy_vehicle_source_idx
    ON timeseries.parallax_parked_energy_samples (vehicle_id, source_at DESC, period_window);

CREATE TABLE timeseries.parallax_charge_breakdown_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    total_kwh double precision,
    pack_kwh double precision,
    thermal_kwh double precision,
    duration_minutes integer,
    charging_state integer,
    completion_state integer,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash)
);
CREATE INDEX parallax_charge_breakdown_vehicle_source_idx
    ON timeseries.parallax_charge_breakdown_samples (vehicle_id, source_at DESC);

CREATE TABLE timeseries.parallax_cold_weather_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    payload_hash bytea NOT NULL,
    available_soc_pct integer,
    cold_limited_soc_pct integer,
    cold_range_impact_km double precision,
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, payload_hash)
);
CREATE INDEX parallax_cold_weather_vehicle_source_idx
    ON timeseries.parallax_cold_weather_samples (vehicle_id, source_at DESC);
