CREATE SCHEMA IF NOT EXISTS riviamigo;
CREATE SCHEMA IF NOT EXISTS timeseries;

CREATE TABLE riviamigo.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE riviamigo.refresh_tokens (
  token_hash  BYTEA PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX ON riviamigo.refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE riviamigo.vehicles (
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

CREATE INDEX ON riviamigo.vehicles (user_id);

ALTER TABLE riviamigo.users ADD COLUMN IF NOT EXISTS default_vehicle_id UUID REFERENCES riviamigo.vehicles(id) ON DELETE SET NULL;

CREATE TABLE riviamigo.vehicle_credentials (
  vehicle_id        UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  encrypted_tokens  BYTEA NOT NULL,
  token_created_at  TIMESTAMPTZ NOT NULL,
  last_refreshed_at TIMESTAMPTZ
);

CREATE TABLE riviamigo.vehicle_runtime_state (
  vehicle_id        UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  is_online         BOOLEAN,
  last_event_at     TIMESTAMPTZ,
  worker_health     TEXT,
  worker_health_msg TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE riviamigo.trips (
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

CREATE TABLE riviamigo.charge_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  location_lat        FLOAT8,
  location_lng        FLOAT8,
  is_home             BOOLEAN,
  charger_type        TEXT,
  kwh_added           FLOAT8,
  soc_start           FLOAT8,
  soc_end             FLOAT8,
  charge_limit        FLOAT8,
  max_charge_rate_kw  FLOAT8,
  duration_minutes    INT,
  cost_usd            FLOAT8,
  rivian_session_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE riviamigo.user_preferences (
  user_id                  UUID PRIMARY KEY REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  electricity_rate_per_kwh FLOAT8 DEFAULT 0.13,
  distance_unit            TEXT DEFAULT 'miles',
  temperature_unit         TEXT DEFAULT 'fahrenheit',
  home_timezone            TEXT DEFAULT 'America/Chicago',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE riviamigo.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  key_hash    BYTEA NOT NULL UNIQUE,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
