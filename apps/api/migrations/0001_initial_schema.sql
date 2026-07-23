-- no-transaction
-- Riviamigo release baseline.
-- This schema-only snapshot is the initial state for fresh installs.
-- Existing pre-release databases are adopted with pnpm db:rebaseline;
-- do not apply this file directly to a populated database.

CREATE SCHEMA IF NOT EXISTS riviamigo;
CREATE SCHEMA IF NOT EXISTS timeseries;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA riviamigo;
CREATE EXTENSION IF NOT EXISTS earthdistance WITH SCHEMA riviamigo;

--
-- PostgreSQL database dump
--

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: riviamigo; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS riviamigo;

--
-- Name: timeseries; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS timeseries;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: telemetry; Type: TABLE; Schema: timeseries; Owner: -
--

CREATE TABLE timeseries.telemetry (
    ts timestamp with time zone NOT NULL,
    vehicle_id uuid NOT NULL,
    latitude double precision,
    longitude double precision,
    altitude_m double precision,
    speed_mph double precision,
    battery_level double precision,
    battery_capacity_wh double precision,
    distance_to_empty_mi double precision,
    battery_limit double precision,
    power_state text,
    charger_state text,
    charger_status text,
    time_to_end_of_charge_min integer,
    drive_mode text,
    gear_status text,
    cabin_temp_c double precision,
    driver_temp_c double precision,
    odometer_miles double precision,
    hv_thermal_event text,
    twelve_volt_health text,
    is_online boolean,
    heading_deg double precision,
    outside_temp_c double precision,
    hvac_active boolean,
    power_kw double precision,
    regen_power_kw double precision,
    tire_fl_psi double precision,
    tire_fr_psi double precision,
    tire_rl_psi double precision,
    tire_rr_psi double precision,
    tire_fl_status text,
    tire_fr_status text,
    tire_rl_status text,
    tire_rr_status text,
    door_front_left_locked boolean,
    door_front_right_locked boolean,
    door_rear_left_locked boolean,
    door_rear_right_locked boolean,
    door_front_left_closed boolean,
    door_front_right_closed boolean,
    door_rear_left_closed boolean,
    door_rear_right_closed boolean,
    closure_frunk_locked boolean,
    closure_frunk_closed boolean,
    closure_liftgate_locked boolean,
    closure_liftgate_closed boolean,
    closure_tailgate_locked boolean,
    closure_tailgate_closed boolean,
    ota_current_version text,
    ota_available_version text,
    ota_status text,
    ota_current_status text,
    trip_id uuid,
    charge_session_id uuid,
    charge_port_open boolean,
    charger_derate_active boolean,

    cabin_precon_status text,
    cabin_precon_type text,
    pet_mode_active boolean,
    pet_mode_temp_ok boolean,
    defrost_active boolean,
    steering_wheel_heat smallint,
    seat_fl_heat smallint,
    seat_fr_heat smallint,
    seat_rl_heat smallint,
    seat_rr_heat smallint,
    seat_fl_vent smallint,
    seat_fr_vent smallint,
    tonneau_locked boolean,
    tonneau_closed boolean,
    side_bin_left_locked boolean,
    side_bin_right_locked boolean,
    window_fl_closed boolean,
    window_fr_closed boolean,
    window_rl_closed boolean,
    window_rr_closed boolean,
    gear_guard_locked boolean,
    gear_guard_video_status text,
    wiper_fluid_low boolean,
    brake_fluid_low boolean,
    alarm_active boolean,
    service_mode boolean,
    tire_fl_valid boolean,
    tire_fr_valid boolean,
    tire_rl_valid boolean,
    tire_rr_valid boolean,
    side_bin_left_closed boolean,
    side_bin_right_closed boolean
);

--
-- Name: rivian_charge_payloads; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.rivian_charge_payloads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    charge_session_id uuid,
    operation text NOT NULL,
    rivian_transaction_id text,
    rivian_vehicle_id text,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb NOT NULL
);

--
-- Name: account_invitations; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.account_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invited_by uuid NOT NULL,
    invitee_email text NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vehicle_id uuid
);

--
-- Name: addresses; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    osm_id bigint,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    road text,
    city text,
    state text,
    postcode text,
    country text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: api_keys; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    key_hash bytea NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,

    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    access_level text DEFAULT 'view'::text NOT NULL,
    name text,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT api_keys_access_level_check CHECK ((access_level = ANY (ARRAY['view'::text, 'edit'::text, 'admin'::text])))
);

--
-- Name: backup_artifacts; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.backup_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    storage_type text DEFAULT 'local'::text NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    manifest jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_artifacts_storage_type_check CHECK ((storage_type = ANY (ARRAY['local'::text, 'uploaded'::text, 'safety'::text, 's3'::text])))
);

--
-- Name: backup_restore_requests; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.backup_restore_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artifact_id uuid NOT NULL,
    requested_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    confirmation_phrase text NOT NULL,
    notes text,
    error_message text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_restore_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'running'::text, 'completed'::text, 'failed'::text, 'canceled'::text])))
);

--
-- Name: backup_runs; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.backup_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trigger text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid,
    artifact_key text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backup_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text]))),
    CONSTRAINT backup_runs_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text, 'restore'::text, 'upload'::text, 'pre_restore'::text])))
);

--
-- Name: backup_settings; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.backup_settings (
    id boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    frequency text DEFAULT 'weekly'::text NOT NULL,
    run_at time without time zone DEFAULT '03:00:00'::time without time zone NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    day_of_week smallint,
    day_of_month smallint,
    retention_count integer DEFAULT 8 NOT NULL,
    target_type text DEFAULT 's3'::text NOT NULL,
    endpoint text DEFAULT ''::text NOT NULL,
    region text,
    bucket text DEFAULT ''::text NOT NULL,
    prefix text DEFAULT 'riviamigo'::text NOT NULL,
    access_key text,
    secret_key_encrypted bytea,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    local_enabled boolean DEFAULT true NOT NULL,
    s3_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT backup_settings_day_of_month_check CHECK (((day_of_month IS NULL) OR ((day_of_month >= 1) AND (day_of_month <= 31)))),
    CONSTRAINT backup_settings_day_of_week_check CHECK (((day_of_week IS NULL) OR ((day_of_week >= 0) AND (day_of_week <= 6)))),
    CONSTRAINT backup_settings_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT backup_settings_id_check CHECK ((id = true)),
    CONSTRAINT backup_settings_retention_check CHECK ((retention_count >= 1)),
    CONSTRAINT backup_settings_target_type_check CHECK ((target_type = 's3'::text))
);

--
-- Name: battery_capacity_snapshots; Type: TABLE; Schema: riviamigo; Owner: -

--

CREATE TABLE riviamigo.battery_capacity_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    snapshotted_at timestamp with time zone NOT NULL,
    odometer_mi double precision,
    usable_kwh double precision NOT NULL,
    rated_kwh double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: charge_session_external_aliases; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.charge_session_external_aliases (
    charge_session_id uuid NOT NULL,
    external_id text NOT NULL,
    alias_kind text NOT NULL,
    transaction_id_grouping_key text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    latest_payload_id uuid,
    latest_payload_captured_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: charge_session_user_annotations; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.charge_session_user_annotations (
    charge_session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    geofence_id uuid,
    address_id uuid,
    is_home boolean,
    cost_profile_id uuid,
    cost_method text,
    cost_usd double precision,
    currency_code text,
    computed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: charge_sessions; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.charge_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    location_lat double precision,
    location_lng double precision,
    is_home boolean,
    charger_type text,
    kwh_added double precision,
    soc_start double precision,
    soc_end double precision,
    charge_limit double precision,
    max_charge_rate_kw double precision,
    duration_minutes integer,
    cost_usd double precision,
    rivian_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outside_temp_c double precision,
    energy_added_wh double precision,
    cost_profile_id uuid,
    cost_method text,
    energy_used_wh double precision,
    avg_charge_rate_kw double precision,
    peak_voltage double precision,
    geofence_id uuid,
    address_id uuid,
    network_vendor text,
    range_added_km double precision,
    is_free_session boolean,
    is_rivian_network boolean,
    rivian_paid_total double precision,
    source text,
    rivian_charger_type text,
    currency_code text,
    rivian_city text,
    rivian_vehicle_id text,
    rivian_vehicle_name text,
    is_public boolean,
    rivian_meta jsonb,
    charger_id text,
    live_current_price double precision,
    live_current_currency text,
    live_total_charged_kwh double precision,
    live_range_added_km double precision,

    live_power_kw double precision,
    live_charge_rate_kph double precision,
    live_time_elapsed_seconds integer,
    live_session_started_at timestamp with time zone,
    api_started_at timestamp with time zone,
    api_ended_at timestamp with time zone,
    data_confidence text
);

--
-- Name: charging_schedules; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.charging_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    start_time_minutes integer,
    duration_minutes integer,
    amperage double precision,
    location_lat double precision,
    location_lng double precision,
    week_days text[],
    rivian_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: cost_profiles; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.cost_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    billing_type text NOT NULL,
    rate double precision DEFAULT 0 NOT NULL,
    session_fee double precision DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    effective_from date,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text,
    tou_periods jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT cost_profiles_billing_type_check CHECK ((billing_type = ANY (ARRAY['per_kwh'::text, 'per_minute'::text, 'free'::text, 'flat'::text, 'tou'::text])))
);

--
-- Name: dashboards; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.dashboards (
    id uuid NOT NULL,
    owner_id uuid,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    is_default boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    baseline_revision integer
);

COMMENT ON COLUMN riviamigo.dashboards.baseline_revision IS
  'Bundled system-dashboard revision last applied to this row; NULL for personal dashboards and pre-revision defaults.';

--
-- Name: departure_schedules; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.departure_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    rivian_schedule_id text NOT NULL,
    name text,
    enabled boolean DEFAULT false NOT NULL,
    occurrence jsonb,
    comfort_settings jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: external_connection_activity; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.external_connection_activity (
    connection_id text NOT NULL,
    last_attempt_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error text,
    usage_date date DEFAULT CURRENT_DATE NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    last_test_at timestamp with time zone,
    last_test_ok boolean,
    last_test_error text,

    last_test_checks jsonb
);

--
-- Name: external_connection_settings; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.external_connection_settings (
    id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    mode text DEFAULT 'remote'::text NOT NULL,
    weather_precision text,
    forecast_url text,
    archive_url text,
    base_url text,
    light_url_template text,
    dark_url_template text,
    attribution text,
    attribution_url text,
    request_identifier text,
    custom_autocomplete boolean DEFAULT false NOT NULL,
    allow_private_network boolean DEFAULT false NOT NULL,
    api_key_encrypted bytea,
    bearer_token_encrypted bytea,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT external_connection_mode_check CHECK ((mode = ANY (ARRAY['remote'::text, 'custom'::text, 'disabled'::text]))),
    CONSTRAINT external_connection_weather_precision_check CHECK (((weather_precision IS NULL) OR (weather_precision = ANY (ARRAY['approximate'::text, 'exact'::text]))))
);

--
-- Name: geofences; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.geofences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    radius_m double precision DEFAULT 50 NOT NULL,
    address_id uuid,
    is_home boolean DEFAULT false NOT NULL,
    is_work boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_profile_id uuid
);

--
-- Name: refresh_tokens; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.refresh_tokens (
    token_hash bytea NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);

--
-- Name: rivian_charge_curve_points; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.rivian_charge_curve_points (
    vehicle_id uuid NOT NULL,
    charge_session_id uuid,
    ts timestamp with time zone NOT NULL,
    power_kw double precision,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: rivian_parallax_events; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.rivian_parallax_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    trip_id uuid,
    charge_session_id uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    server_timestamp timestamp with time zone,
    rvm text NOT NULL,
    payload_b64 text NOT NULL
);

--
-- Name: rivian_stewardship_counters; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.rivian_stewardship_counters (
    vehicle_id uuid NOT NULL,
    day date NOT NULL,
    ws_messages_received bigint DEFAULT 0 NOT NULL,
    ws_heartbeats_received bigint DEFAULT 0 NOT NULL,
    ws_payload_messages_received bigint DEFAULT 0 NOT NULL,
    ws_control_messages_received bigint DEFAULT 0 NOT NULL,
    ws_connections_opened bigint DEFAULT 0 NOT NULL,
    ws_reconnects bigint DEFAULT 0 NOT NULL,
    outbound_messages_sent bigint DEFAULT 0 NOT NULL,
    outbound_graphql_requests bigint DEFAULT 0 NOT NULL,
    telemetry_writes_persisted bigint DEFAULT 0 NOT NULL,
    telemetry_writes_suppressed bigint DEFAULT 0 NOT NULL,
    telemetry_suppressed_duplicate bigint DEFAULT 0 NOT NULL,
    telemetry_suppressed_empty bigint DEFAULT 0 NOT NULL,
    telemetry_suppressed_threshold bigint DEFAULT 0 NOT NULL,
    collector_lock_skips bigint DEFAULT 0 NOT NULL,
    raw_events_persisted bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parallax_events_persisted bigint DEFAULT 0 NOT NULL
);

--
-- Name: rivian_ws_raw_events; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.rivian_ws_raw_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type text NOT NULL,
    message_type text,
    payload_json jsonb,
    payload_text text
);

--
-- Name: security_events; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.security_events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    user_id uuid,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: riviamigo; Owner: -
--

CREATE SEQUENCE riviamigo.security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: security_events_id_seq; Type: SEQUENCE OWNED BY; Schema: riviamigo; Owner: -
--

ALTER SEQUENCE riviamigo.security_events_id_seq OWNED BY riviamigo.security_events.id;

--
-- Name: service_events; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.service_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    event_type text NOT NULL,
    performed_at timestamp with time zone NOT NULL,
    odometer_mi double precision,
    cost_usd double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: software_versions; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.software_versions (
    id bigint NOT NULL,
    vehicle_id uuid NOT NULL,
    version text NOT NULL,
    installed_at timestamp with time zone NOT NULL,
    observed_until timestamp with time zone
);

--
-- Name: software_versions_id_seq; Type: SEQUENCE; Schema: riviamigo; Owner: -

--

CREATE SEQUENCE riviamigo.software_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: software_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: riviamigo; Owner: -
--

ALTER SEQUENCE riviamigo.software_versions_id_seq OWNED BY riviamigo.software_versions.id;

--
-- Name: system_config; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.system_config (
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: trip_user_annotations; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.trip_user_annotations (
    trip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    start_geofence_id uuid,
    end_geofence_id uuid,
    start_address_id uuid,
    end_address_id uuid,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: trip_weather_samples; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.trip_weather_samples (
    trip_id uuid NOT NULL,
    sampled_at timestamp with time zone NOT NULL,
    elapsed_seconds integer NOT NULL,
    provider_latitude double precision NOT NULL,
    provider_longitude double precision NOT NULL,
    temperature_c double precision NOT NULL,
    source text DEFAULT 'open_meteo'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trip_weather_samples_source_check CHECK ((source = 'open_meteo'::text))
);

--
-- Name: trips; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    start_lat double precision,
    start_lng double precision,
    end_lat double precision,
    end_lng double precision,
    distance_miles double precision,
    duration_seconds integer,
    soc_start double precision,
    soc_end double precision,
    efficiency_wh_per_mile double precision,
    max_speed_mph double precision,
    drive_mode text,
    outside_temp_c double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    avg_speed_mph double precision,
    energy_wh double precision,
    regen_wh double precision,
    elevation_gain_m double precision,
    start_odometer_mi double precision,
    end_odometer_mi double precision,
    start_position_ts timestamp with time zone,
    end_position_ts timestamp with time zone,
    start_geofence_id uuid,
    end_geofence_id uuid,
    start_address_id uuid,
    end_address_id uuid,
    power_max_kw double precision,
    power_min_kw double precision,
    elevation_loss_m double precision,
    inside_temp_avg_c double precision,

    range_start_mi double precision,
    range_end_mi double precision,
    energy_strategy text,
    route_preview jsonb,
    route_preview_version smallint,
    outside_temp_source text,
    CONSTRAINT trips_outside_temp_source_check CHECK (((outside_temp_source IS NULL) OR (outside_temp_source = ANY (ARRAY['vehicle'::text, 'open_meteo'::text, 'mixed'::text]))))
);

--
-- Name: user_preferences; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.user_preferences (
    user_id uuid NOT NULL,
    electricity_rate_per_kwh double precision,
    distance_unit text DEFAULT 'miles'::text,
    temperature_unit text DEFAULT 'fahrenheit'::text,
    home_timezone text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unit_mode text DEFAULT 'imperial'::text NOT NULL,
    custom_distance_unit text,
    custom_speed_unit text,
    custom_temperature_unit text,
    custom_pressure_unit text,
    custom_altitude_unit text,
    custom_place_radius_unit text,
    custom_efficiency_display text,
    CONSTRAINT user_preferences_custom_altitude_unit_check CHECK (((custom_altitude_unit IS NULL) OR (custom_altitude_unit = ANY (ARRAY['feet'::text, 'meters'::text])))),
    CONSTRAINT user_preferences_custom_distance_unit_check CHECK (((custom_distance_unit IS NULL) OR (custom_distance_unit = ANY (ARRAY['miles'::text, 'kilometers'::text])))),
    CONSTRAINT user_preferences_custom_efficiency_display_check CHECK (((custom_efficiency_display IS NULL) OR (custom_efficiency_display = ANY (ARRAY['distance_per_energy'::text, 'energy_per_distance'::text])))),
    CONSTRAINT user_preferences_custom_place_radius_unit_check CHECK (((custom_place_radius_unit IS NULL) OR (custom_place_radius_unit = ANY (ARRAY['feet'::text, 'meters'::text])))),
    CONSTRAINT user_preferences_custom_pressure_unit_check CHECK (((custom_pressure_unit IS NULL) OR (custom_pressure_unit = ANY (ARRAY['psi'::text, 'kpa'::text])))),
    CONSTRAINT user_preferences_custom_speed_unit_check CHECK (((custom_speed_unit IS NULL) OR (custom_speed_unit = ANY (ARRAY['mph'::text, 'kmh'::text])))),
    CONSTRAINT user_preferences_custom_temperature_unit_check CHECK (((custom_temperature_unit IS NULL) OR (custom_temperature_unit = ANY (ARRAY['fahrenheit'::text, 'celsius'::text])))),
    CONSTRAINT user_preferences_unit_mode_check CHECK ((unit_mode = ANY (ARRAY['imperial'::text, 'metric'::text, 'custom'::text])))
);

--
-- Name: users; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    default_vehicle_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    is_disabled boolean DEFAULT false NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['super_user'::text, 'admin'::text, 'user'::text])))
);

--
-- Name: vehicle_artwork_cache_state; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_artwork_cache_state (
    vehicle_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    asset_count integer DEFAULT 0 NOT NULL,
    ready_asset_count integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_repair_attempt_at timestamp with time zone,
    last_repair_success_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_artwork_cache_state_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'repairing'::text, 'ready'::text, 'failed'::text])))
);

--
-- Name: vehicle_credentials; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_credentials (
    vehicle_id uuid NOT NULL,
    encrypted_tokens bytea NOT NULL,
    token_created_at timestamp with time zone NOT NULL,
    last_refreshed_at timestamp with time zone
);

--
-- Name: vehicle_images; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    placement text NOT NULL,
    design text,
    size text,
    resolution text,
    url text NOT NULL,

    overlays jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: vehicle_invites; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    invitee_email text NOT NULL,
    role text NOT NULL,
    token_hash bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    accepted_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])))
);

--
-- Name: vehicle_latest_status; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_latest_status (
    vehicle_id uuid NOT NULL,
    ts timestamp with time zone,
    latitude double precision,
    longitude double precision,
    altitude_m double precision,
    speed_mph double precision,
    battery_level double precision,
    battery_capacity_wh double precision,
    distance_to_empty_mi double precision,
    battery_limit double precision,
    power_state text,
    charger_state text,
    charger_state_ts timestamp with time zone,
    charger_status text,
    time_to_end_of_charge_min integer,
    drive_mode text,
    gear_status text,
    cabin_temp_c double precision,
    driver_temp_c double precision,
    outside_temp_c double precision,
    heading_deg double precision,
    odometer_miles double precision,
    tire_fl_psi double precision,
    tire_fr_psi double precision,
    tire_rl_psi double precision,
    tire_rr_psi double precision,
    tire_fl_status text,
    tire_fr_status text,
    tire_rl_status text,
    tire_rr_status text,
    door_front_left_locked boolean,
    door_front_right_locked boolean,
    door_rear_left_locked boolean,
    door_rear_right_locked boolean,
    door_front_left_closed boolean,
    door_front_right_closed boolean,
    door_rear_left_closed boolean,
    door_rear_right_closed boolean,
    closure_frunk_locked boolean,
    closure_frunk_closed boolean,
    closure_liftgate_locked boolean,
    closure_liftgate_closed boolean,
    closure_tailgate_locked boolean,
    closure_tailgate_closed boolean,
    ota_current_version text,
    ota_available_version text,
    ota_status text,
    ota_current_status text,
    hv_thermal_event text,
    twelve_volt_health text,
    charge_port_open boolean,
    charger_derate_active boolean,
    cabin_precon_status text,
    cabin_precon_type text,
    pet_mode_active boolean,
    pet_mode_temp_ok boolean,
    defrost_active boolean,
    steering_wheel_heat smallint,
    seat_fl_heat smallint,
    seat_fr_heat smallint,
    seat_rl_heat smallint,
    seat_rr_heat smallint,
    seat_fl_vent smallint,
    seat_fr_vent smallint,
    tonneau_locked boolean,
    tonneau_closed boolean,
    side_bin_left_locked boolean,

    side_bin_right_locked boolean,
    window_fl_closed boolean,
    window_fr_closed boolean,
    window_rl_closed boolean,
    window_rr_closed boolean,
    gear_guard_locked boolean,
    gear_guard_video_status text,
    wiper_fluid_low boolean,
    brake_fluid_low boolean,
    alarm_active boolean,
    service_mode boolean,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tire_fl_valid boolean,
    tire_fr_valid boolean,
    tire_rl_valid boolean,
    tire_rr_valid boolean,
    side_bin_left_closed boolean,
    side_bin_right_closed boolean,
    battery_level_ts timestamp with time zone,
    distance_to_empty_mi_ts timestamp with time zone,
    battery_limit_ts timestamp with time zone,
    power_state_ts timestamp with time zone,
    charger_status_ts timestamp with time zone,
    time_to_end_of_charge_min_ts timestamp with time zone,
    location_ts timestamp with time zone,
    speed_mph_ts timestamp with time zone,
    odometer_miles_ts timestamp with time zone
);

--
-- Name: vehicle_memberships; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])))
);

--
-- Name: vehicle_runtime_state; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_runtime_state (
    vehicle_id uuid NOT NULL,
    is_online boolean,
    last_event_at timestamp with time zone,
    worker_health text,
    worker_health_msg text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    last_payload_at timestamp with time zone,
    last_persisted_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone,
    auth_state text,
    auth_reason_code text,
    consecutive_auth_failures integer DEFAULT 0 NOT NULL,
    last_auth_failure_at timestamp with time zone,
    last_ws_received_at timestamp with time zone,
    last_ws_payload_received_at timestamp with time zone,
    last_ws_heartbeat_received_at timestamp with time zone,
    last_charge_history_sync_at timestamp with time zone,
    last_charge_history_success_at timestamp with time zone
);

--
-- Name: vehicle_state_periods; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_state_periods (
    id bigint NOT NULL,
    vehicle_id uuid NOT NULL,
    state text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer GENERATED ALWAYS AS (
CASE
    WHEN (ended_at IS NULL) THEN NULL::integer
    ELSE (EXTRACT(epoch FROM (ended_at - started_at)))::integer
END) STORED,
    CONSTRAINT vehicle_state_periods_state_check CHECK ((state = ANY (ARRAY['drive'::text, 'charging'::text, 'ready'::text, 'sleep'::text, 'offline'::text, 'updating'::text, 'unknown'::text])))
);

--
-- Name: vehicle_state_periods_id_seq; Type: SEQUENCE; Schema: riviamigo; Owner: -
--

CREATE SEQUENCE riviamigo.vehicle_state_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE

    NO MAXVALUE
    CACHE 1;

--
-- Name: vehicle_state_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: riviamigo; Owner: -
--

ALTER SEQUENCE riviamigo.vehicle_state_periods_id_seq OWNED BY riviamigo.vehicle_state_periods.id;

--
-- Name: vehicle_user_settings; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicle_user_settings (
    vehicle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    display_name text,
    display_priority smallint DEFAULT 0 NOT NULL,
    home_geofence_id uuid,
    default_cost_profile_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: vehicles; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rivian_vehicle_id text NOT NULL,
    vin text,
    model text NOT NULL,
    "trim" text,
    color text,
    battery_config text,
    battery_capacity_wh double precision,
    home_latitude double precision,
    home_longitude double precision,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    display_priority smallint DEFAULT 0 NOT NULL,
    cost_profile_id uuid,
    home_geofence_id uuid,
    firmware_version text,
    interior_color text,
    wheel_option text,
    max_vehicle_power_kw double precision,
    charge_port_type text,
    battery_cell_type text,
    supported_features jsonb,
    ota_release_notes_url text,
    history_backfilled_at timestamp with time zone,
    history_backfill_status text,
    history_session_count integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_tire_pressure_psi double precision DEFAULT 48
);

--
-- Name: wallboxes; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.wallboxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rivian_wallbox_id text NOT NULL,
    name text,
    latitude double precision,
    longitude double precision,
    max_power_kw double precision,
    model text,
    serial_number text,
    firmware_version text,
    linked boolean,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: weather_enrichment_jobs; Type: TABLE; Schema: riviamigo; Owner: -
--

CREATE TABLE riviamigo.weather_enrichment_jobs (
    trip_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT weather_enrichment_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'unavailable'::text, 'failed'::text])))
);

--
-- Name: efficiency_trend_7d; Type: VIEW; Schema: timeseries; Owner: -
--

CREATE VIEW timeseries.efficiency_trend_7d AS
 SELECT vehicle_id,
    (started_at)::date AS day,
    avg(efficiency_wh_per_mile) OVER (PARTITION BY vehicle_id ORDER BY ((started_at)::date) ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_7d_wh_mi,
    avg(efficiency_wh_per_mile) AS day_avg_wh_mi
   FROM riviamigo.trips
  WHERE (efficiency_wh_per_mile IS NOT NULL)
  GROUP BY vehicle_id, ((started_at)::date), efficiency_wh_per_mile;

--
-- Name: efficiency_vs_temp; Type: VIEW; Schema: timeseries; Owner: -
--

CREATE VIEW timeseries.efficiency_vs_temp AS
 SELECT vehicle_id,
    width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13) AS temp_bucket,
    (round((('-20'::integer + ((width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13) - 1) * 5)))::numeric, 0))::integer AS temp_c_low,
    (round((('-20'::integer + (width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13) * 5)))::numeric, 0))::integer AS temp_c_high,
    avg(efficiency_wh_per_mile) AS avg_efficiency_wh_mi,
    count(*) AS trip_count
   FROM riviamigo.trips t
  WHERE ((outside_temp_c IS NOT NULL) AND (efficiency_wh_per_mile IS NOT NULL))
  GROUP BY vehicle_id, (width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13)), ((round((('-20'::integer + ((width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13) - 1) * 5)))::numeric, 0))::integer), ((round((('-20'::integer + (width_bucket(outside_temp_c, ('-20'::integer)::double precision, (45)::double precision, 13) * 5)))::numeric, 0))::integer);

--
-- Name: phantom_drain_periods; Type: VIEW; Schema: timeseries; Owner: -
--

CREATE VIEW timeseries.phantom_drain_periods AS
 WITH anchors AS (
         SELECT trips.vehicle_id,
            trips.started_at,
            trips.ended_at,
            trips.soc_start,
            trips.soc_end
           FROM riviamigo.trips
          WHERE ((trips.ended_at IS NOT NULL) AND (trips.started_at >= (now() - '365 days'::interval)) AND (trips.soc_start IS NOT NULL) AND (trips.soc_end IS NOT NULL))
        UNION ALL
         SELECT charge_sessions.vehicle_id,
            charge_sessions.started_at,
            charge_sessions.ended_at,
            charge_sessions.soc_start,
            charge_sessions.soc_end
           FROM riviamigo.charge_sessions
          WHERE ((charge_sessions.ended_at IS NOT NULL) AND (charge_sessions.started_at >= (now() - '365 days'::interval)) AND (charge_sessions.soc_start IS NOT NULL) AND (charge_sessions.soc_end IS NOT NULL))
        UNION ALL
         SELECT vehicle_state_periods.vehicle_id,
            vehicle_state_periods.started_at,
            vehicle_state_periods.ended_at,
            NULL::double precision AS soc_start,
            NULL::double precision AS soc_end
           FROM riviamigo.vehicle_state_periods
          WHERE ((vehicle_state_periods.ended_at IS NOT NULL) AND (vehicle_state_periods.started_at >= (now() - '365 days'::interval)) AND (vehicle_state_periods.state = ANY (ARRAY['drive'::text, 'charging'::text])))
        ), ordered AS (
         SELECT anchors.vehicle_id,
            anchors.started_at AS current_start,
            anchors.ended_at AS current_end,
            anchors.soc_start AS current_soc_start,
            anchors.soc_end AS current_soc_end,
            lag(anchors.ended_at) OVER w AS prev_end,
            lag(anchors.soc_end) OVER w AS prev_soc_end
           FROM anchors
          WINDOW w AS (PARTITION BY anchors.vehicle_id ORDER BY anchors.started_at, anchors.ended_at)
        ), periods AS (
         SELECT ordered.vehicle_id,
            ordered.prev_end AS period_start,
            ordered.current_start AS period_end,
            ordered.prev_soc_end,
            ordered.current_soc_start
           FROM ordered
          WHERE ((ordered.prev_end IS NOT NULL) AND (ordered.current_start > ordered.prev_end))
        ), enriched AS (
         SELECT p.vehicle_id,
            p.period_start,
            p.period_end,
            COALESCE(p.prev_soc_end, start_sample.soc) AS soc_start,
            COALESCE(p.current_soc_start, end_sample.soc) AS soc_end
           FROM ((periods p
             LEFT JOIN LATERAL ( SELECT t.battery_level AS soc
                   FROM timeseries.telemetry t

                  WHERE ((t.vehicle_id = p.vehicle_id) AND (t.ts <= p.period_start) AND (t.battery_level IS NOT NULL))
                  ORDER BY t.ts DESC
                 LIMIT 1) start_sample ON (true))
             LEFT JOIN LATERAL ( SELECT t.battery_level AS soc
                   FROM timeseries.telemetry t
                  WHERE ((t.vehicle_id = p.vehicle_id) AND (t.ts >= p.period_end) AND (t.battery_level IS NOT NULL))
                  ORDER BY t.ts
                 LIMIT 1) end_sample ON (true))
        )
 SELECT vehicle_id,
    period_start,
    period_end,
    soc_start,
    soc_end,
    GREATEST((soc_start - soc_end), (0)::double precision) AS soc_lost_pct,
    (EXTRACT(epoch FROM (period_end - period_start)) / 3600.0) AS duration_hours,
        CASE
            WHEN (EXTRACT(epoch FROM (period_end - period_start)) > (0)::numeric) THEN (GREATEST((soc_start - soc_end), (0)::double precision) / ((EXTRACT(epoch FROM (period_end - period_start)) / 3600.0))::double precision)
            ELSE NULL::double precision
        END AS drain_pct_per_hour
   FROM enriched
  WHERE (((period_end - period_start) >= '00:15:00'::interval) AND (soc_start IS NOT NULL) AND (soc_end IS NOT NULL) AND (soc_start >= soc_end));

--
-- Name: phantom_drain_daily; Type: VIEW; Schema: timeseries; Owner: -
--
CREATE VIEW timeseries.phantom_drain_daily AS
 SELECT vehicle_id,
    date(period_start) AS day,
    sum(soc_lost_pct) AS soc_lost_pct_total,
    sum(duration_hours) AS hours_idle,
    avg(drain_pct_per_hour) AS avg_drain_pct_per_hour,
    count(*) AS idle_period_count
   FROM timeseries.phantom_drain_periods
  GROUP BY vehicle_id, (date(period_start));

--
-- Name: telemetry_1day; Type: VIEW; Schema: timeseries; Owner: -
--

CREATE VIEW timeseries.telemetry_1day AS
 SELECT public.time_bucket('1 day'::interval, ts) AS bucket,
    vehicle_id,
    avg(battery_level) AS avg_soc,
    min(battery_level) AS min_soc,
    max(battery_level) AS max_soc,
    avg(distance_to_empty_mi) AS avg_range_mi,
    max(battery_capacity_wh) AS battery_capacity_wh,
    avg(cabin_temp_c) AS avg_cabin_temp_c,
    count(*) AS sample_count,
    avg(outside_temp_c) AS avg_outside_temp_c
   FROM timeseries.telemetry
  GROUP BY (public.time_bucket('1 day'::interval, ts)), vehicle_id;

--
-- Name: telemetry_1hr; Type: VIEW; Schema: timeseries; Owner: -
--

CREATE VIEW timeseries.telemetry_1hr AS
 SELECT public.time_bucket('01:00:00'::interval, ts) AS bucket,
    vehicle_id,
    avg(battery_level) AS avg_soc,
    min(battery_level) AS min_soc,
    max(battery_level) AS max_soc,
    avg(distance_to_empty_mi) AS avg_range_mi,
    avg(speed_mph) AS avg_speed_mph,
    max(speed_mph) AS max_speed_mph,
    avg(cabin_temp_c) AS avg_cabin_temp_c,
    max(battery_capacity_wh) AS battery_capacity_wh,
    count(*) AS sample_count,
    avg(power_kw) AS avg_power_kw,
    avg(outside_temp_c) AS avg_outside_temp_c
   FROM timeseries.telemetry
  GROUP BY (public.time_bucket('01:00:00'::interval, ts)), vehicle_id;

--
-- Name: security_events id; Type: DEFAULT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.security_events ALTER COLUMN id SET DEFAULT nextval('riviamigo.security_events_id_seq'::regclass);

--
-- Name: software_versions id; Type: DEFAULT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.software_versions ALTER COLUMN id SET DEFAULT nextval('riviamigo.software_versions_id_seq'::regclass);

--
-- Name: vehicle_state_periods id; Type: DEFAULT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_state_periods ALTER COLUMN id SET DEFAULT nextval('riviamigo.vehicle_state_periods_id_seq'::regclass);

--
-- Name: account_invitations account_invitations_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.account_invitations
    ADD CONSTRAINT account_invitations_pkey PRIMARY KEY (id);

--
-- Name: account_invitations account_invitations_token_hash_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.account_invitations
    ADD CONSTRAINT account_invitations_token_hash_key UNIQUE (token_hash);

--
-- Name: addresses addresses_osm_id_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.addresses
    ADD CONSTRAINT addresses_osm_id_key UNIQUE (osm_id);

--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);

--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);

--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

--
-- Name: backup_artifacts backup_artifacts_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -

--

ALTER TABLE ONLY riviamigo.backup_artifacts
    ADD CONSTRAINT backup_artifacts_pkey PRIMARY KEY (id);

--
-- Name: backup_restore_requests backup_restore_requests_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_restore_requests
    ADD CONSTRAINT backup_restore_requests_pkey PRIMARY KEY (id);

--
-- Name: backup_runs backup_runs_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_runs
    ADD CONSTRAINT backup_runs_pkey PRIMARY KEY (id);

--
-- Name: backup_settings backup_settings_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_settings
    ADD CONSTRAINT backup_settings_pkey PRIMARY KEY (id);

--
-- Name: battery_capacity_snapshots battery_capacity_snapshots_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.battery_capacity_snapshots
    ADD CONSTRAINT battery_capacity_snapshots_pkey PRIMARY KEY (id);

--
-- Name: charge_session_external_aliases charge_session_external_aliases_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_external_aliases
    ADD CONSTRAINT charge_session_external_aliases_pkey PRIMARY KEY (charge_session_id, external_id);

--
-- Name: charge_session_user_annotations charge_session_user_annotations_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_pkey PRIMARY KEY (charge_session_id, user_id);

--
-- Name: charge_sessions charge_sessions_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_pkey PRIMARY KEY (id);

--
-- Name: charging_schedules charging_schedules_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charging_schedules
    ADD CONSTRAINT charging_schedules_pkey PRIMARY KEY (id);

--
-- Name: charging_schedules charging_schedules_vehicle_id_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charging_schedules
    ADD CONSTRAINT charging_schedules_vehicle_id_key UNIQUE (vehicle_id);

--
-- Name: cost_profiles cost_profiles_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.cost_profiles
    ADD CONSTRAINT cost_profiles_pkey PRIMARY KEY (id);

--
-- Name: dashboards dashboards_owner_id_slug_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.dashboards
    ADD CONSTRAINT dashboards_owner_id_slug_key UNIQUE NULLS NOT DISTINCT (owner_id, slug);

--
-- Name: dashboards dashboards_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.dashboards
    ADD CONSTRAINT dashboards_pkey PRIMARY KEY (id);

--
-- Name: departure_schedules departure_schedules_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.departure_schedules
    ADD CONSTRAINT departure_schedules_pkey PRIMARY KEY (id);

--
-- Name: departure_schedules departure_schedules_vehicle_id_rivian_schedule_id_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.departure_schedules
    ADD CONSTRAINT departure_schedules_vehicle_id_rivian_schedule_id_key UNIQUE (vehicle_id, rivian_schedule_id);

--
-- Name: external_connection_activity external_connection_activity_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.external_connection_activity
    ADD CONSTRAINT external_connection_activity_pkey PRIMARY KEY (connection_id);

--
-- Name: external_connection_settings external_connection_settings_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.external_connection_settings
    ADD CONSTRAINT external_connection_settings_pkey PRIMARY KEY (id);

--
-- Name: geofences geofences_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);

--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_hash);
--
-- Name: rivian_charge_curve_points rivian_charge_curve_points_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.rivian_charge_curve_points
    ADD CONSTRAINT rivian_charge_curve_points_pkey PRIMARY KEY (vehicle_id, ts);

--
-- Name: rivian_parallax_events rivian_parallax_events_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.rivian_parallax_events
    ADD CONSTRAINT rivian_parallax_events_pkey PRIMARY KEY (id);

--
-- Name: rivian_stewardship_counters rivian_stewardship_counters_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.rivian_stewardship_counters
    ADD CONSTRAINT rivian_stewardship_counters_pkey PRIMARY KEY (vehicle_id, day);

--
-- Name: rivian_ws_raw_events rivian_ws_raw_events_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.rivian_ws_raw_events
    ADD CONSTRAINT rivian_ws_raw_events_pkey PRIMARY KEY (id);

--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);

--
-- Name: service_events service_events_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -

--

ALTER TABLE ONLY riviamigo.service_events
    ADD CONSTRAINT service_events_pkey PRIMARY KEY (id);

--
-- Name: software_versions software_versions_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.software_versions
    ADD CONSTRAINT software_versions_pkey PRIMARY KEY (id);

--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (key);

--
-- Name: trip_user_annotations trip_user_annotations_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.trip_user_annotations
    ADD CONSTRAINT trip_user_annotations_pkey PRIMARY KEY (trip_id, user_id);

--
-- Name: trip_weather_samples trip_weather_samples_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.trip_weather_samples
    ADD CONSTRAINT trip_weather_samples_pkey PRIMARY KEY (trip_id, sampled_at);

--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);

--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: vehicle_artwork_cache_state vehicle_artwork_cache_state_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_artwork_cache_state
    ADD CONSTRAINT vehicle_artwork_cache_state_pkey PRIMARY KEY (vehicle_id);

--
-- Name: vehicle_credentials vehicle_credentials_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_credentials
    ADD CONSTRAINT vehicle_credentials_pkey PRIMARY KEY (vehicle_id);

--
-- Name: vehicle_images vehicle_images_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_images
    ADD CONSTRAINT vehicle_images_pkey PRIMARY KEY (id);

--
-- Name: vehicle_invites vehicle_invites_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_invites
    ADD CONSTRAINT vehicle_invites_pkey PRIMARY KEY (id);

--
-- Name: vehicle_invites vehicle_invites_token_hash_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_invites
    ADD CONSTRAINT vehicle_invites_token_hash_key UNIQUE (token_hash);

--
-- Name: vehicle_latest_status vehicle_latest_status_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_latest_status
    ADD CONSTRAINT vehicle_latest_status_pkey PRIMARY KEY (vehicle_id);

--
-- Name: vehicle_memberships vehicle_memberships_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_memberships
    ADD CONSTRAINT vehicle_memberships_pkey PRIMARY KEY (id);

--
-- Name: vehicle_memberships vehicle_memberships_unique; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_memberships
    ADD CONSTRAINT vehicle_memberships_unique UNIQUE (vehicle_id, user_id);

--
-- Name: vehicle_runtime_state vehicle_runtime_state_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_runtime_state
    ADD CONSTRAINT vehicle_runtime_state_pkey PRIMARY KEY (vehicle_id);

--
-- Name: vehicle_state_periods vehicle_state_periods_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_state_periods
    ADD CONSTRAINT vehicle_state_periods_pkey PRIMARY KEY (id);

--
-- Name: vehicle_user_settings vehicle_user_settings_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicle_user_settings
    ADD CONSTRAINT vehicle_user_settings_pkey PRIMARY KEY (vehicle_id, user_id);

--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);

--
-- Name: wallboxes wallboxes_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.wallboxes
    ADD CONSTRAINT wallboxes_pkey PRIMARY KEY (id);

--
-- Name: wallboxes wallboxes_user_id_rivian_wallbox_id_key; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.wallboxes
    ADD CONSTRAINT wallboxes_user_id_rivian_wallbox_id_key UNIQUE (user_id, rivian_wallbox_id);

--
-- Name: weather_enrichment_jobs weather_enrichment_jobs_pkey; Type: CONSTRAINT; Schema: riviamigo; Owner: -
--
ALTER TABLE ONLY riviamigo.weather_enrichment_jobs
    ADD CONSTRAINT weather_enrichment_jobs_pkey PRIMARY KEY (trip_id);

--
-- Name: telemetry telemetry_unique_sample; Type: CONSTRAINT; Schema: timeseries; Owner: -
--

ALTER TABLE ONLY timeseries.telemetry
    ADD CONSTRAINT telemetry_unique_sample UNIQUE (vehicle_id, ts);

--
-- Name: account_invitations_active_email_idx; Type: INDEX; Schema: riviamigo; Owner: -

--

CREATE UNIQUE INDEX account_invitations_active_email_idx ON riviamigo.account_invitations USING btree (lower(invitee_email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

--
-- Name: account_invitations_created_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX account_invitations_created_idx ON riviamigo.account_invitations USING btree (created_at DESC);

--
-- Name: account_invitations_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX account_invitations_vehicle_idx ON riviamigo.account_invitations USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL);

--
-- Name: addresses_ll_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX addresses_ll_idx ON riviamigo.addresses USING gist (riviamigo.ll_to_earth(latitude, longitude));

--
-- Name: api_keys_user_active_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX api_keys_user_active_idx ON riviamigo.api_keys USING btree (user_id, created_at DESC) WHERE (revoked_at IS NULL);

--
-- Name: api_keys_vehicle_active_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX api_keys_vehicle_active_idx ON riviamigo.api_keys USING btree (vehicle_id, created_at DESC) WHERE (revoked_at IS NULL);

--
-- Name: backup_artifacts_created_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_artifacts_created_idx ON riviamigo.backup_artifacts USING btree (created_at DESC);

--
-- Name: backup_artifacts_run_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_artifacts_run_idx ON riviamigo.backup_artifacts USING btree (run_id);

CREATE UNIQUE INDEX backup_artifacts_s3_locator_unique ON riviamigo.backup_artifacts USING btree (storage_path) WHERE (storage_type = 's3'::text);

--
-- Name: backup_restore_requests_artifact_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_restore_requests_artifact_idx ON riviamigo.backup_restore_requests USING btree (artifact_id, status);

--
-- Name: backup_restore_requests_requested_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_restore_requests_requested_idx ON riviamigo.backup_restore_requests USING btree (requested_at DESC);

--
-- Name: backup_runs_created_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_runs_created_idx ON riviamigo.backup_runs USING btree (created_at DESC);

--
-- Name: backup_runs_status_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX backup_runs_status_idx ON riviamigo.backup_runs USING btree (status, created_at DESC);

--
-- Name: charge_session_external_aliases_external_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX charge_session_external_aliases_external_idx ON riviamigo.charge_session_external_aliases USING btree (external_id);

--
-- Name: charge_session_external_aliases_grouping_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX charge_session_external_aliases_grouping_idx ON riviamigo.charge_session_external_aliases USING btree (transaction_id_grouping_key) WHERE (transaction_id_grouping_key IS NOT NULL);

--
-- Name: charge_sessions_source_idx; Type: INDEX; Schema: riviamigo; Owner: -
--
CREATE INDEX charge_sessions_source_idx ON riviamigo.charge_sessions USING btree (vehicle_id, source) WHERE (source IS NOT NULL);

--
-- Name: cost_profiles_tou_gin_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX cost_profiles_tou_gin_idx ON riviamigo.cost_profiles USING gin (tou_periods);

--
-- Name: cost_profiles_user_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX cost_profiles_user_idx ON riviamigo.cost_profiles USING btree (user_id);

--
-- Name: cs_geofence_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX cs_geofence_idx ON riviamigo.charge_sessions USING btree (geofence_id) WHERE (geofence_id IS NOT NULL);

--
-- Name: dashboards_default_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX dashboards_default_idx ON riviamigo.dashboards USING btree (is_default) WHERE (is_default = true);

--
-- Name: dashboards_owner_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX dashboards_owner_idx ON riviamigo.dashboards USING btree (owner_id);

--
-- Name: dashboards_slug_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX dashboards_slug_idx ON riviamigo.dashboards USING btree (slug);

--
-- Name: departure_schedules_vehicle_id_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX departure_schedules_vehicle_id_idx ON riviamigo.departure_schedules USING btree (vehicle_id);

--
-- Name: geofences_ll_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX geofences_ll_idx ON riviamigo.geofences USING gist (riviamigo.ll_to_earth(latitude, longitude));

--
-- Name: geofences_user_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX geofences_user_idx ON riviamigo.geofences USING btree (user_id);

--
-- Name: idx_api_keys_active; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX idx_api_keys_active ON riviamigo.api_keys USING btree (key_hash) WHERE (revoked_at IS NULL);

--
-- Name: idx_capacity_snapshots_vehicle_ts; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX idx_capacity_snapshots_vehicle_ts ON riviamigo.battery_capacity_snapshots USING btree (vehicle_id, snapshotted_at DESC);

--
-- Name: idx_charge_sessions_vehicle_started; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX idx_charge_sessions_vehicle_started ON riviamigo.charge_sessions USING btree (vehicle_id, started_at DESC);

--
-- Name: idx_charge_sessions_vehicle_started_no_rivian; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX idx_charge_sessions_vehicle_started_no_rivian ON riviamigo.charge_sessions USING btree (vehicle_id, started_at) WHERE (rivian_session_id IS NULL);

--
-- Name: idx_trips_vehicle_started; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX idx_trips_vehicle_started ON riviamigo.trips USING btree (vehicle_id, started_at DESC);

--
-- Name: idx_vehicle_images_vehicle_placement; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX idx_vehicle_images_vehicle_placement ON riviamigo.vehicle_images USING btree (vehicle_id, placement, design, size);

--
-- Name: idx_vehicle_state_periods_open; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX idx_vehicle_state_periods_open ON riviamigo.vehicle_state_periods USING btree (vehicle_id) WHERE (ended_at IS NULL);

--
-- Name: refresh_tokens_user_id_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX refresh_tokens_user_id_idx ON riviamigo.refresh_tokens USING btree (user_id) WHERE (revoked_at IS NULL);

--
-- Name: rivian_charge_curve_points_session_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_charge_curve_points_session_idx ON riviamigo.rivian_charge_curve_points USING btree (charge_session_id, ts) WHERE (charge_session_id IS NOT NULL);

--
-- Name: rivian_charge_payloads_captured_at_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_charge_payloads_captured_at_idx ON riviamigo.rivian_charge_payloads USING btree (captured_at DESC);

--
-- Name: rivian_charge_payloads_id_captured_uidx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX rivian_charge_payloads_id_captured_uidx ON riviamigo.rivian_charge_payloads USING btree (id, captured_at);

--
-- Name: rivian_charge_payloads_transaction_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_charge_payloads_transaction_idx ON riviamigo.rivian_charge_payloads USING btree (rivian_transaction_id) WHERE (rivian_transaction_id IS NOT NULL);

--
-- Name: rivian_charge_payloads_vehicle_captured_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_charge_payloads_vehicle_captured_idx ON riviamigo.rivian_charge_payloads USING btree (vehicle_id, captured_at DESC);

--
-- Name: rivian_parallax_events_rvm_received_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_parallax_events_rvm_received_idx ON riviamigo.rivian_parallax_events USING btree (rvm, received_at DESC);

--
-- Name: rivian_parallax_events_trip_received_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_parallax_events_trip_received_idx ON riviamigo.rivian_parallax_events USING btree (trip_id, received_at) WHERE (trip_id IS NOT NULL);

--
-- Name: rivian_parallax_events_vehicle_received_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_parallax_events_vehicle_received_idx ON riviamigo.rivian_parallax_events USING btree (vehicle_id, received_at DESC);

--
-- Name: rivian_stewardship_counters_day_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_stewardship_counters_day_idx ON riviamigo.rivian_stewardship_counters USING btree (day DESC);

--
-- Name: rivian_ws_raw_events_received_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_ws_raw_events_received_idx ON riviamigo.rivian_ws_raw_events USING btree (received_at);

--
-- Name: rivian_ws_raw_events_vehicle_received_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX rivian_ws_raw_events_vehicle_received_idx ON riviamigo.rivian_ws_raw_events USING btree (vehicle_id, received_at DESC);

--

-- Name: security_events_event_type_created_at_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX security_events_event_type_created_at_idx ON riviamigo.security_events USING btree (event_type, created_at DESC);

--
-- Name: security_events_type_created_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX security_events_type_created_idx ON riviamigo.security_events USING btree (event_type, created_at DESC);

--
-- Name: security_events_user_created_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX security_events_user_created_idx ON riviamigo.security_events USING btree (user_id, created_at DESC);

--
-- Name: security_events_user_id_created_at_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX security_events_user_id_created_at_idx ON riviamigo.security_events USING btree (user_id, created_at DESC);

--
-- Name: service_events_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX service_events_vehicle_idx ON riviamigo.service_events USING btree (vehicle_id, performed_at DESC);
--
-- Name: sv_open_one_per_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX sv_open_one_per_vehicle_idx ON riviamigo.software_versions USING btree (vehicle_id) WHERE (observed_until IS NULL);

--
-- Name: sv_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX sv_vehicle_idx ON riviamigo.software_versions USING btree (vehicle_id, installed_at DESC);

--
-- Name: trip_weather_samples_trip_elapsed_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX trip_weather_samples_trip_elapsed_idx ON riviamigo.trip_weather_samples USING btree (trip_id, elapsed_seconds);

--
-- Name: trips_geofence_end_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX trips_geofence_end_idx ON riviamigo.trips USING btree (end_geofence_id) WHERE (end_geofence_id IS NOT NULL);

--
-- Name: trips_geofence_start_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX trips_geofence_start_idx ON riviamigo.trips USING btree (start_geofence_id) WHERE (start_geofence_id IS NOT NULL);

--
-- Name: trips_route_preview_missing_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX trips_route_preview_missing_idx ON riviamigo.trips USING btree (vehicle_id, started_at) WHERE ((route_preview IS NULL) OR (route_preview_version IS DISTINCT FROM 1));

--
-- Name: uq_charge_sessions_rivian_session; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX uq_charge_sessions_rivian_session ON riviamigo.charge_sessions USING btree (rivian_session_id) WHERE (rivian_session_id IS NOT NULL);

--
-- Name: uq_vehicle_images_vehicle_url; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX uq_vehicle_images_vehicle_url ON riviamigo.vehicle_images USING btree (vehicle_id, url);

--
-- Name: uq_vehicles_user_rivian_vehicle_id; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX uq_vehicles_user_rivian_vehicle_id ON riviamigo.vehicles USING btree (user_id, rivian_vehicle_id);

--
-- Name: vehicle_artwork_cache_state_next_attempt_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_artwork_cache_state_next_attempt_idx ON riviamigo.vehicle_artwork_cache_state USING btree (status, next_attempt_at);

--
-- Name: vehicle_invites_active_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_invites_active_idx ON riviamigo.vehicle_invites USING btree (invitee_email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

--
-- Name: vehicle_invites_email_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_invites_email_idx ON riviamigo.vehicle_invites USING btree (invitee_email, created_at DESC);

--
-- Name: vehicle_invites_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_invites_vehicle_idx ON riviamigo.vehicle_invites USING btree (vehicle_id, created_at DESC);

--
-- Name: vehicle_memberships_default_user_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE UNIQUE INDEX vehicle_memberships_default_user_idx ON riviamigo.vehicle_memberships USING btree (user_id) WHERE (is_default = true);

--
-- Name: vehicle_memberships_user_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_memberships_user_idx ON riviamigo.vehicle_memberships USING btree (user_id, created_at DESC);

--
-- Name: vehicle_memberships_vehicle_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vehicle_memberships_vehicle_idx ON riviamigo.vehicle_memberships USING btree (vehicle_id, created_at DESC);

--
-- Name: vehicles_user_id_idx; Type: INDEX; Schema: riviamigo; Owner: -
--
CREATE INDEX vehicles_user_id_idx ON riviamigo.vehicles USING btree (user_id);

--
-- Name: vsp_open_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vsp_open_idx ON riviamigo.vehicle_state_periods USING btree (vehicle_id) WHERE (ended_at IS NULL);

--
-- Name: vsp_range_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX vsp_range_idx ON riviamigo.vehicle_state_periods USING btree (vehicle_id, started_at DESC);

--
-- Name: wallboxes_user_id_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX wallboxes_user_id_idx ON riviamigo.wallboxes USING btree (user_id);

--
-- Name: weather_enrichment_jobs_ready_idx; Type: INDEX; Schema: riviamigo; Owner: -
--

CREATE INDEX weather_enrichment_jobs_ready_idx ON riviamigo.weather_enrichment_jobs USING btree (next_attempt_at, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

--
-- Name: idx_telemetry_vehicle_charger_state_ts; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_charger_state_ts ON timeseries.telemetry USING btree (vehicle_id, charger_state, ts DESC) WHERE (charger_state IS NOT NULL);

--
-- Name: idx_telemetry_vehicle_odometer; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_odometer ON timeseries.telemetry USING btree (vehicle_id, ts DESC) WHERE (odometer_miles IS NOT NULL);

--
-- Name: idx_telemetry_vehicle_power_state_ts; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_power_state_ts ON timeseries.telemetry USING btree (vehicle_id, power_state, ts DESC) WHERE (power_state IS NOT NULL);

--
-- Name: idx_telemetry_vehicle_ts; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_ts ON timeseries.telemetry USING btree (vehicle_id, ts DESC);

--
-- Name: telemetry_charge_idx; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX telemetry_charge_idx ON timeseries.telemetry USING btree (charge_session_id, ts) WHERE (charge_session_id IS NOT NULL);

--
-- Name: telemetry_ll_idx; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX telemetry_ll_idx ON timeseries.telemetry USING gist (riviamigo.ll_to_earth(latitude, longitude)) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));

--
-- Name: telemetry_trip_idx; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX telemetry_trip_idx ON timeseries.telemetry USING btree (trip_id, ts) WHERE (trip_id IS NOT NULL);

--
-- Name: telemetry_ts_idx; Type: INDEX; Schema: timeseries; Owner: -
--

CREATE INDEX telemetry_ts_idx ON timeseries.telemetry USING btree (ts DESC);

--
-- Name: account_invitations account_invitations_created_user_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.account_invitations
    ADD CONSTRAINT account_invitations_created_user_id_fkey FOREIGN KEY (created_user_id) REFERENCES riviamigo.users(id) ON DELETE SET NULL;

--
-- Name: account_invitations account_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.account_invitations
    ADD CONSTRAINT account_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES riviamigo.users(id) ON DELETE CASCADE;

--
-- Name: account_invitations account_invitations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.account_invitations
    ADD CONSTRAINT account_invitations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE SET NULL;

--
-- Name: api_keys api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--
ALTER TABLE ONLY riviamigo.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES riviamigo.users(id) ON DELETE CASCADE;

--
-- Name: api_keys api_keys_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.api_keys
    ADD CONSTRAINT api_keys_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE;

--
-- Name: backup_artifacts backup_artifacts_run_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_artifacts
    ADD CONSTRAINT backup_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES riviamigo.backup_runs(id) ON DELETE CASCADE;

--
-- Name: backup_restore_requests backup_restore_requests_artifact_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_restore_requests
    ADD CONSTRAINT backup_restore_requests_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES riviamigo.backup_artifacts(id) ON DELETE CASCADE;

--
-- Name: backup_restore_requests backup_restore_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_restore_requests
    ADD CONSTRAINT backup_restore_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES riviamigo.users(id) ON DELETE SET NULL;

--
-- Name: backup_runs backup_runs_requested_by_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_runs
    ADD CONSTRAINT backup_runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES riviamigo.users(id) ON DELETE SET NULL;

--
-- Name: backup_settings backup_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.backup_settings
    ADD CONSTRAINT backup_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES riviamigo.users(id) ON DELETE SET NULL;

--
-- Name: battery_capacity_snapshots battery_capacity_snapshots_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.battery_capacity_snapshots
    ADD CONSTRAINT battery_capacity_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE;

--
-- Name: charge_session_external_aliases charge_session_external_aliases_charge_session_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_external_aliases
    ADD CONSTRAINT charge_session_external_aliases_charge_session_id_fkey FOREIGN KEY (charge_session_id) REFERENCES riviamigo.charge_sessions(id) ON DELETE CASCADE;

--
-- Name: charge_session_user_annotations charge_session_user_annotations_address_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_address_id_fkey FOREIGN KEY (address_id) REFERENCES riviamigo.addresses(id) ON DELETE SET NULL;

--
-- Name: charge_session_user_annotations charge_session_user_annotations_charge_session_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_charge_session_id_fkey FOREIGN KEY (charge_session_id) REFERENCES riviamigo.charge_sessions(id) ON DELETE CASCADE;

--
-- Name: charge_session_user_annotations charge_session_user_annotations_cost_profile_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_cost_profile_id_fkey FOREIGN KEY (cost_profile_id) REFERENCES riviamigo.cost_profiles(id) ON DELETE SET NULL;

--
-- Name: charge_session_user_annotations charge_session_user_annotations_geofence_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_geofence_id_fkey FOREIGN KEY (geofence_id) REFERENCES riviamigo.geofences(id) ON DELETE SET NULL;

--
-- Name: charge_session_user_annotations charge_session_user_annotations_user_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_session_user_annotations
    ADD CONSTRAINT charge_session_user_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES riviamigo.users(id) ON DELETE CASCADE;

--
-- Name: charge_sessions charge_sessions_address_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_address_id_fkey FOREIGN KEY (address_id) REFERENCES riviamigo.addresses(id);
--
-- Name: charge_sessions charge_sessions_cost_profile_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_cost_profile_id_fkey FOREIGN KEY (cost_profile_id) REFERENCES riviamigo.cost_profiles(id);

--
-- Name: charge_sessions charge_sessions_geofence_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_geofence_id_fkey FOREIGN KEY (geofence_id) REFERENCES riviamigo.geofences(id);

--
-- Name: charge_sessions charge_sessions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charge_sessions
    ADD CONSTRAINT charge_sessions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE;

--
-- Name: charging_schedules charging_schedules_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.charging_schedules
    ADD CONSTRAINT charging_schedules_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE;

--
-- Name: cost_profiles cost_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.cost_profiles
    ADD CONSTRAINT cost_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES riviamigo.users(id) ON DELETE CASCADE;

--
-- Name: dashboards dashboards_owner_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.dashboards
    ADD CONSTRAINT dashboards_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES riviamigo.users(id) ON DELETE CASCADE;

--
-- Name: departure_schedules departure_schedules_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: riviamigo; Owner: -
--

ALTER TABLE ONLY riviamigo.departure_schedules
    ADD CONSTRAINT departure_schedules_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--
-- Restore TimescaleDB-specific objects that pg_dump represents as views.
SET search_path = riviamigo, timeseries, public;

SELECT create_hypertable(
  'riviamigo.rivian_charge_payloads',
  'captured_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'riviamigo.rivian_charge_payloads',
  drop_after => INTERVAL '90 days',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

SELECT create_hypertable(
  'timeseries.telemetry',
  'ts',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW timeseries.odometer_daily
  WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  time_bucket('1 day', ts) AS day,
  max(odometer_miles) AS odometer_end,
  max(odometer_miles) - min(odometer_miles) AS miles_driven
FROM timeseries.telemetry
WHERE odometer_miles IS NOT NULL
GROUP BY vehicle_id, time_bucket('1 day', ts)
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'timeseries.odometer_daily',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true
);

CREATE MATERIALIZED VIEW timeseries.telemetry_1min
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  vehicle_id,
  avg(battery_level) AS avg_soc,
  avg(distance_to_empty_mi) AS avg_range_mi,
  avg(speed_mph) AS avg_speed_mph,
  max(speed_mph) AS max_speed_mph,
  avg(cabin_temp_c) AS avg_cabin_temp_c,
  last(power_state, ts) AS power_state,
  last(charger_state, ts) AS charger_state,
  last(drive_mode, ts) AS drive_mode,
  last(odometer_miles, ts) AS odometer_miles,
  max(battery_capacity_wh) AS battery_capacity_wh,
  count(*) AS sample_count,
  avg(power_kw) AS avg_power_kw,
  sum(CASE WHEN regen_power_kw < 0 THEN regen_power_kw ELSE 0 END) AS regen_kw_sum,
  avg(outside_temp_c) AS avg_outside_temp_c
FROM timeseries.telemetry
GROUP BY time_bucket('1 minute', ts), vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'timeseries.telemetry_1min',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true
);

-- END RIVIAMIGO RELEASE BASELINE
