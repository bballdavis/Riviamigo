CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS riviamigo;
CREATE SCHEMA IF NOT EXISTS timeseries;

CREATE TABLE IF NOT EXISTS riviamigo.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  default_vehicle_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riviamigo.refresh_tokens (
  token_hash BYTEA PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS riviamigo.vehicles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  rivian_vehicle_id   TEXT NOT NULL,
  vin                 TEXT,
  model               TEXT NOT NULL,
  trim                TEXT,
  color               TEXT,
  battery_config      TEXT,
  battery_capacity_wh FLOAT8,
  home_latitude       FLOAT8,
  home_longitude      FLOAT8,
  name                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_default_vehicle_id_fkey'
      AND conrelid = 'riviamigo.users'::regclass
  ) THEN
    ALTER TABLE riviamigo.users
      ADD CONSTRAINT users_default_vehicle_id_fkey
      FOREIGN KEY (default_vehicle_id)
      REFERENCES riviamigo.vehicles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS riviamigo.vehicle_credentials (
  vehicle_id        UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  encrypted_tokens  BYTEA NOT NULL,
  token_created_at  TIMESTAMPTZ NOT NULL,
  last_refreshed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS riviamigo.vehicle_runtime_state (
  vehicle_id        UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  is_online         BOOLEAN,
  last_event_at     TIMESTAMPTZ,
  worker_health     TEXT,
  worker_health_msg TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riviamigo.trips (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  started_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ NOT NULL,
  start_lat              FLOAT8,
  start_lng              FLOAT8,
  end_lat                FLOAT8,
  end_lng                FLOAT8,
  distance_miles         FLOAT8,
  duration_seconds       INT,
  soc_start              FLOAT8,
  soc_end                FLOAT8,
  efficiency_wh_per_mile FLOAT8,
  max_speed_mph          FLOAT8,
  drive_mode             TEXT,
  outside_temp_c         FLOAT8,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riviamigo.charge_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  started_at         TIMESTAMPTZ NOT NULL,
  ended_at           TIMESTAMPTZ,
  location_lat       FLOAT8,
  location_lng       FLOAT8,
  is_home            BOOLEAN,
  charger_type       TEXT,
  kwh_added          FLOAT8,
  soc_start          FLOAT8,
  soc_end            FLOAT8,
  charge_limit       FLOAT8,
  max_charge_rate_kw FLOAT8,
  duration_minutes   INT,
  cost_usd           FLOAT8,
  rivian_session_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riviamigo.user_preferences (
  user_id                  UUID PRIMARY KEY REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  electricity_rate_per_kwh FLOAT8 DEFAULT 0.13,
  distance_unit            TEXT DEFAULT 'miles',
  temperature_unit         TEXT DEFAULT 'fahrenheit',
  home_timezone            TEXT DEFAULT 'America/Chicago',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS riviamigo.api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  key_hash     BYTEA NOT NULL UNIQUE,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS riviamigo.system_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeseries.telemetry (
  ts                        TIMESTAMPTZ NOT NULL,
  vehicle_id                UUID NOT NULL,
  latitude                  FLOAT8,
  longitude                 FLOAT8,
  altitude_m                FLOAT8,
  speed_mph                 FLOAT8,
  battery_level             FLOAT8,
  battery_capacity_wh       FLOAT8,
  distance_to_empty_mi      FLOAT8,
  battery_limit             FLOAT8,
  power_state               TEXT,
  charger_state             TEXT,
  charger_status            TEXT,
  time_to_end_of_charge_min INT,
  drive_mode                TEXT,
  gear_status               TEXT,
  cabin_temp_c              FLOAT8,
  driver_temp_c             FLOAT8,
  odometer_miles            FLOAT8,
  hv_thermal_event          TEXT,
  twelve_volt_health        TEXT,
  is_online                 BOOLEAN
);

SELECT create_hypertable(
  'timeseries.telemetry',
  'ts',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
  ON riviamigo.refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS vehicles_user_id_idx
  ON riviamigo.vehicles (user_id);

CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started
  ON riviamigo.trips (vehicle_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_charge_sessions_vehicle_started
  ON riviamigo.charge_sessions (vehicle_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_sessions_rivian_session
  ON riviamigo.charge_sessions (rivian_session_id)
  WHERE rivian_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON riviamigo.api_keys (key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_ts
  ON timeseries.telemetry (vehicle_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_power_state_ts
  ON timeseries.telemetry (vehicle_id, power_state, ts DESC)
  WHERE power_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_charger_state_ts
  ON timeseries.telemetry (vehicle_id, charger_state, ts DESC)
  WHERE charger_state IS NOT NULL;

-- Keep first boot deterministic: the API reads analytics through stable view names,
-- and we can add materialization or policies later as an optimization if needed.
CREATE OR REPLACE VIEW timeseries.telemetry_1min AS
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
  count(*) AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

CREATE OR REPLACE VIEW timeseries.telemetry_1hr AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  vehicle_id,
  avg(battery_level) AS avg_soc,
  min(battery_level) AS min_soc,
  max(battery_level) AS max_soc,
  avg(distance_to_empty_mi) AS avg_range_mi,
  avg(speed_mph) AS avg_speed_mph,
  max(speed_mph) AS max_speed_mph,
  avg(cabin_temp_c) AS avg_cabin_temp_c,
  max(battery_capacity_wh) AS battery_capacity_wh,
  count(*) AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

CREATE OR REPLACE VIEW timeseries.telemetry_1day AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  vehicle_id,
  avg(battery_level) AS avg_soc,
  min(battery_level) AS min_soc,
  max(battery_level) AS max_soc,
  avg(distance_to_empty_mi) AS avg_range_mi,
  max(battery_capacity_wh) AS battery_capacity_wh,
  avg(cabin_temp_c) AS avg_cabin_temp_c,
  count(*) AS sample_count
FROM timeseries.telemetry
GROUP BY 1, 2;

CREATE OR REPLACE VIEW timeseries.phantom_drain_periods AS
WITH parked_segments AS (
  SELECT
    vehicle_id,
    ts,
    battery_level,
    power_state,
    LAG(battery_level) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_soc,
    LAG(ts) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_ts
  FROM timeseries.telemetry
  WHERE power_state = 'sleep'
),
drain_events AS (
  SELECT
    vehicle_id,
    prev_ts AS period_start,
    ts AS period_end,
    prev_soc AS soc_start,
    battery_level AS soc_end,
    (prev_soc - battery_level) AS soc_lost,
    EXTRACT(EPOCH FROM (ts - prev_ts)) / 3600.0 AS hours_elapsed
  FROM parked_segments
  WHERE prev_soc IS NOT NULL
    AND (prev_soc - battery_level) > 0
    AND EXTRACT(EPOCH FROM (ts - prev_ts)) > 300
)
SELECT
  vehicle_id,
  period_start,
  period_end,
  soc_start,
  soc_end,
  soc_lost,
  hours_elapsed,
  soc_lost / NULLIF(hours_elapsed, 0) AS drain_rate_soc_per_hour
FROM drain_events;

CREATE OR REPLACE VIEW timeseries.phantom_drain_daily AS
SELECT
  date_trunc('day', period_start) AS day,
  vehicle_id,
  sum(soc_lost) AS total_soc_lost,
  sum(hours_elapsed) AS total_hours_parked,
  avg(drain_rate_soc_per_hour) AS avg_drain_rate,
  count(*) AS drain_events
FROM timeseries.phantom_drain_periods
GROUP BY 1, 2;
