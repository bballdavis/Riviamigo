-- Migration 0045: shared-vehicle ownership model, per-user annotations, and
-- latest-status storage for scalable hosted multi-user deployments.

-- Canonical vehicle access now flows through memberships instead of
-- vehicles.user_id. Keep vehicles.user_id for compatibility during the
-- transition, but backfill all existing vehicles into the new table.
CREATE TABLE IF NOT EXISTS riviamigo.vehicle_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_memberships_role_check
    CHECK (role IN ('owner', 'manager', 'viewer')),
  CONSTRAINT vehicle_memberships_unique UNIQUE (vehicle_id, user_id)
);

CREATE INDEX IF NOT EXISTS vehicle_memberships_user_idx
  ON riviamigo.vehicle_memberships (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicle_memberships_vehicle_idx
  ON riviamigo.vehicle_memberships (vehicle_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_memberships_default_user_idx
  ON riviamigo.vehicle_memberships (user_id)
  WHERE is_default = TRUE;

INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
SELECT
  v.id,
  v.user_id,
  'owner',
  COALESCE(u.default_vehicle_id = v.id, FALSE)
FROM riviamigo.vehicles v
JOIN riviamigo.users u ON u.id = v.user_id
ON CONFLICT (vehicle_id, user_id) DO UPDATE
SET
  role = EXCLUDED.role,
  is_default = EXCLUDED.is_default,
  updated_at = now();

-- Per-user preferences for a shared vehicle.
CREATE TABLE IF NOT EXISTS riviamigo.vehicle_user_settings (
  vehicle_id                UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  display_name              TEXT,
  display_priority          SMALLINT NOT NULL DEFAULT 0,
  home_geofence_id          UUID REFERENCES riviamigo.geofences(id) ON DELETE SET NULL,
  default_cost_profile_id   UUID REFERENCES riviamigo.cost_profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, user_id)
);

INSERT INTO riviamigo.vehicle_user_settings (
  vehicle_id,
  user_id,
  display_name,
  display_priority,
  home_geofence_id,
  default_cost_profile_id
)
SELECT
  id,
  user_id,
  name,
  display_priority,
  home_geofence_id,
  cost_profile_id
FROM riviamigo.vehicles
ON CONFLICT (vehicle_id, user_id) DO UPDATE
SET
  display_name = COALESCE(riviamigo.vehicle_user_settings.display_name, EXCLUDED.display_name),
  display_priority = EXCLUDED.display_priority,
  home_geofence_id = COALESCE(riviamigo.vehicle_user_settings.home_geofence_id, EXCLUDED.home_geofence_id),
  default_cost_profile_id = COALESCE(riviamigo.vehicle_user_settings.default_cost_profile_id, EXCLUDED.default_cost_profile_id),
  updated_at = now();

CREATE TABLE IF NOT EXISTS riviamigo.trip_user_annotations (
  trip_id             UUID NOT NULL REFERENCES riviamigo.trips(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  start_geofence_id   UUID REFERENCES riviamigo.geofences(id) ON DELETE SET NULL,
  end_geofence_id     UUID REFERENCES riviamigo.geofences(id) ON DELETE SET NULL,
  start_address_id    UUID REFERENCES riviamigo.addresses(id) ON DELETE SET NULL,
  end_address_id      UUID REFERENCES riviamigo.addresses(id) ON DELETE SET NULL,
  matched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

INSERT INTO riviamigo.trip_user_annotations (
  trip_id,
  user_id,
  start_geofence_id,
  end_geofence_id,
  start_address_id,
  end_address_id
)
SELECT
  t.id,
  v.user_id,
  t.start_geofence_id,
  t.end_geofence_id,
  t.start_address_id,
  t.end_address_id
FROM riviamigo.trips t
JOIN riviamigo.vehicles v ON v.id = t.vehicle_id
ON CONFLICT (trip_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS riviamigo.charge_session_user_annotations (
  charge_session_id   UUID NOT NULL REFERENCES riviamigo.charge_sessions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  geofence_id         UUID REFERENCES riviamigo.geofences(id) ON DELETE SET NULL,
  address_id          UUID REFERENCES riviamigo.addresses(id) ON DELETE SET NULL,
  is_home             BOOLEAN,
  cost_profile_id     UUID REFERENCES riviamigo.cost_profiles(id) ON DELETE SET NULL,
  cost_method         TEXT,
  cost_usd            FLOAT8,
  currency_code       TEXT,
  computed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (charge_session_id, user_id)
);

INSERT INTO riviamigo.charge_session_user_annotations (
  charge_session_id,
  user_id,
  geofence_id,
  address_id,
  is_home,
  cost_profile_id,
  cost_method,
  cost_usd,
  currency_code,
  computed_at
)
SELECT
  cs.id,
  v.user_id,
  cs.geofence_id,
  cs.address_id,
  cs.is_home,
  cs.cost_profile_id,
  cs.cost_method,
  cs.cost_usd,
  COALESCE(cs.currency_code, 'USD'),
  now()
FROM riviamigo.charge_sessions cs
JOIN riviamigo.vehicles v ON v.id = cs.vehicle_id
ON CONFLICT (charge_session_id, user_id) DO NOTHING;

-- Canonical latest state row so current-status reads do not need to rescan the
-- telemetry hypertable for the last known value of every field.
CREATE TABLE IF NOT EXISTS riviamigo.vehicle_latest_status (
  vehicle_id                   UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  ts                           TIMESTAMPTZ,
  latitude                     FLOAT8,
  longitude                    FLOAT8,
  altitude_m                   FLOAT8,
  speed_mph                    FLOAT8,
  battery_level                FLOAT8,
  battery_capacity_wh          FLOAT8,
  distance_to_empty_mi         FLOAT8,
  battery_limit                FLOAT8,
  power_state                  TEXT,
  charger_state                TEXT,
  charger_state_ts             TIMESTAMPTZ,
  charger_status               TEXT,
  time_to_end_of_charge_min    INT,
  drive_mode                   TEXT,
  gear_status                  TEXT,
  cabin_temp_c                 FLOAT8,
  driver_temp_c                FLOAT8,
  outside_temp_c               FLOAT8,
  heading_deg                  FLOAT8,
  odometer_miles               FLOAT8,
  tire_fl_psi                  FLOAT8,
  tire_fr_psi                  FLOAT8,
  tire_rl_psi                  FLOAT8,
  tire_rr_psi                  FLOAT8,
  tire_fl_status               TEXT,
  tire_fr_status               TEXT,
  tire_rl_status               TEXT,
  tire_rr_status               TEXT,
  door_front_left_locked       BOOLEAN,
  door_front_right_locked      BOOLEAN,
  door_rear_left_locked        BOOLEAN,
  door_rear_right_locked       BOOLEAN,
  door_front_left_closed       BOOLEAN,
  door_front_right_closed      BOOLEAN,
  door_rear_left_closed        BOOLEAN,
  door_rear_right_closed       BOOLEAN,
  closure_frunk_locked         BOOLEAN,
  closure_frunk_closed         BOOLEAN,
  closure_liftgate_locked      BOOLEAN,
  closure_liftgate_closed      BOOLEAN,
  closure_tailgate_locked      BOOLEAN,
  closure_tailgate_closed      BOOLEAN,
  ota_current_version          TEXT,
  ota_available_version        TEXT,
  ota_status                   TEXT,
  ota_current_status           TEXT,
  hv_thermal_event             TEXT,
  twelve_volt_health           TEXT,
  charge_port_open             BOOLEAN,
  charger_derate_active        BOOLEAN,
  cabin_precon_status          TEXT,
  cabin_precon_type            TEXT,
  pet_mode_active              BOOLEAN,
  pet_mode_temp_ok             BOOLEAN,
  defrost_active               BOOLEAN,
  steering_wheel_heat          SMALLINT,
  seat_fl_heat                 SMALLINT,
  seat_fr_heat                 SMALLINT,
  seat_rl_heat                 SMALLINT,
  seat_rr_heat                 SMALLINT,
  seat_fl_vent                 SMALLINT,
  seat_fr_vent                 SMALLINT,
  tonneau_locked               BOOLEAN,
  tonneau_closed               BOOLEAN,
  side_bin_left_locked         BOOLEAN,
  side_bin_right_locked        BOOLEAN,
  window_fl_closed             BOOLEAN,
  window_fr_closed             BOOLEAN,
  window_rl_closed             BOOLEAN,
  window_rr_closed             BOOLEAN,
  gear_guard_locked            BOOLEAN,
  gear_guard_video_status      TEXT,
  wiper_fluid_low              BOOLEAN,
  brake_fluid_low              BOOLEAN,
  alarm_active                 BOOLEAN,
  service_mode                 BOOLEAN,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO riviamigo.vehicle_latest_status (
  vehicle_id, ts, latitude, longitude, altitude_m, speed_mph,
  battery_level, battery_capacity_wh, distance_to_empty_mi, battery_limit,
  power_state, charger_state, charger_state_ts, charger_status, time_to_end_of_charge_min,
  drive_mode, gear_status, cabin_temp_c, driver_temp_c, outside_temp_c,
  heading_deg, odometer_miles,
  tire_fl_psi, tire_fr_psi, tire_rl_psi, tire_rr_psi,
  tire_fl_status, tire_fr_status, tire_rl_status, tire_rr_status,
  door_front_left_locked, door_front_right_locked, door_rear_left_locked, door_rear_right_locked,
  door_front_left_closed, door_front_right_closed, door_rear_left_closed, door_rear_right_closed,
  closure_frunk_locked, closure_frunk_closed, closure_liftgate_locked, closure_liftgate_closed,
  closure_tailgate_locked, closure_tailgate_closed,
  ota_current_version, ota_available_version, ota_status, ota_current_status,
  hv_thermal_event, twelve_volt_health,
  charge_port_open, charger_derate_active, cabin_precon_status, cabin_precon_type,
  pet_mode_active, pet_mode_temp_ok, defrost_active, steering_wheel_heat,
  seat_fl_heat, seat_fr_heat, seat_rl_heat, seat_rr_heat, seat_fl_vent, seat_fr_vent,
  tonneau_locked, tonneau_closed, side_bin_left_locked, side_bin_right_locked,
  window_fl_closed, window_fr_closed, window_rl_closed, window_rr_closed,
  gear_guard_locked, gear_guard_video_status, wiper_fluid_low, brake_fluid_low,
  alarm_active, service_mode
)
SELECT DISTINCT ON (t.vehicle_id)
  t.vehicle_id, t.ts, t.latitude, t.longitude, t.altitude_m, t.speed_mph,
  t.battery_level, t.battery_capacity_wh, t.distance_to_empty_mi, t.battery_limit,
  t.power_state, t.charger_state,
  CASE WHEN t.charger_state IS NOT NULL THEN t.ts ELSE NULL END,
  t.charger_status, t.time_to_end_of_charge_min,
  t.drive_mode, t.gear_status, t.cabin_temp_c, t.driver_temp_c, t.outside_temp_c,
  t.heading_deg, t.odometer_miles,
  t.tire_fl_psi, t.tire_fr_psi, t.tire_rl_psi, t.tire_rr_psi,
  t.tire_fl_status, t.tire_fr_status, t.tire_rl_status, t.tire_rr_status,
  t.door_front_left_locked, t.door_front_right_locked, t.door_rear_left_locked, t.door_rear_right_locked,
  t.door_front_left_closed, t.door_front_right_closed, t.door_rear_left_closed, t.door_rear_right_closed,
  t.closure_frunk_locked, t.closure_frunk_closed, t.closure_liftgate_locked, t.closure_liftgate_closed,
  t.closure_tailgate_locked, t.closure_tailgate_closed,
  t.ota_current_version, t.ota_available_version, t.ota_status, t.ota_current_status,
  t.hv_thermal_event, t.twelve_volt_health,
  t.charge_port_open, t.charger_derate_active, t.cabin_precon_status, t.cabin_precon_type,
  t.pet_mode_active, t.pet_mode_temp_ok, t.defrost_active, t.steering_wheel_heat,
  t.seat_fl_heat, t.seat_fr_heat, t.seat_rl_heat, t.seat_rr_heat, t.seat_fl_vent, t.seat_fr_vent,
  t.tonneau_locked, t.tonneau_closed, t.side_bin_left_locked, t.side_bin_right_locked,
  t.window_fl_closed, t.window_fr_closed, t.window_rl_closed, t.window_rr_closed,
  t.gear_guard_locked, t.gear_guard_video_status, t.wiper_fluid_low, t.brake_fluid_low,
  t.alarm_active, t.service_mode
FROM timeseries.telemetry t
ORDER BY t.vehicle_id, t.ts DESC
ON CONFLICT (vehicle_id) DO NOTHING;

-- API keys become user-owned and may optionally be scoped to a single vehicle.
ALTER TABLE riviamigo.api_keys
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES riviamigo.users(id) ON DELETE CASCADE;

UPDATE riviamigo.api_keys k
SET user_id = v.user_id
FROM riviamigo.vehicles v
WHERE k.vehicle_id = v.id
  AND k.user_id IS NULL;

ALTER TABLE riviamigo.api_keys
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE riviamigo.api_keys
  ALTER COLUMN vehicle_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS api_keys_user_active_idx
  ON riviamigo.api_keys (user_id, created_at DESC)
  WHERE revoked_at IS NULL;
