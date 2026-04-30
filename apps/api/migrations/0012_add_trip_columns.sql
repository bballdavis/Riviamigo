-- Extended columns for trips table.
-- All new columns are nullable so existing rows are unaffected.

ALTER TABLE riviamigo.trips
  -- Odometer values at trip boundaries (enables mileage/odometer chart).
  ADD COLUMN IF NOT EXISTS start_odometer_mi  FLOAT8,
  ADD COLUMN IF NOT EXISTS end_odometer_mi    FLOAT8,

  -- Boundary telemetry timestamps — used as FK-by-time into the hypertable.
  ADD COLUMN IF NOT EXISTS start_position_ts  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_position_ts    TIMESTAMPTZ,

  -- Geofence + address linkage (populated at session close or backfill).
  ADD COLUMN IF NOT EXISTS start_geofence_id  UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN IF NOT EXISTS end_geofence_id    UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN IF NOT EXISTS start_address_id   UUID REFERENCES riviamigo.addresses(id),
  ADD COLUMN IF NOT EXISTS end_address_id     UUID REFERENCES riviamigo.addresses(id),

  -- Power envelope for the drive.
  ADD COLUMN IF NOT EXISTS power_max_kw       FLOAT8,
  ADD COLUMN IF NOT EXISTS power_min_kw       FLOAT8,

  -- Elevation loss (gain already exists from migration 0002).
  ADD COLUMN IF NOT EXISTS elevation_loss_m   FLOAT8,

  -- Inside temp average (cabin comfort).
  ADD COLUMN IF NOT EXISTS inside_temp_avg_c  FLOAT8,

  -- Range at trip boundaries for efficiency cross-check.
  ADD COLUMN IF NOT EXISTS range_start_mi     FLOAT8,
  ADD COLUMN IF NOT EXISTS range_end_mi       FLOAT8,

  -- Which energy strategy was used (soc_delta | range_delta | historical).
  ADD COLUMN IF NOT EXISTS energy_strategy    TEXT;

CREATE INDEX IF NOT EXISTS trips_geofence_start_idx
  ON riviamigo.trips (start_geofence_id)
  WHERE start_geofence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trips_geofence_end_idx
  ON riviamigo.trips (end_geofence_id)
  WHERE end_geofence_id IS NOT NULL;
