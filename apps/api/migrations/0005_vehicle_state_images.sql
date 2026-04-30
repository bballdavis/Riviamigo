ALTER TABLE timeseries.telemetry
  ADD COLUMN IF NOT EXISTS tire_fl_status TEXT,
  ADD COLUMN IF NOT EXISTS tire_fr_status TEXT,
  ADD COLUMN IF NOT EXISTS tire_rl_status TEXT,
  ADD COLUMN IF NOT EXISTS tire_rr_status TEXT,
  ADD COLUMN IF NOT EXISTS door_front_left_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_front_right_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_rear_left_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_rear_right_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_front_left_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_front_right_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_rear_left_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS door_rear_right_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_frunk_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_frunk_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_liftgate_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_liftgate_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_tailgate_locked BOOLEAN,
  ADD COLUMN IF NOT EXISTS closure_tailgate_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS ota_current_version TEXT,
  ADD COLUMN IF NOT EXISTS ota_available_version TEXT,
  ADD COLUMN IF NOT EXISTS ota_status TEXT,
  ADD COLUMN IF NOT EXISTS ota_current_status TEXT;

CREATE TABLE IF NOT EXISTS riviamigo.vehicle_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  placement   TEXT NOT NULL,
  design      TEXT,
  size        TEXT,
  resolution  TEXT,
  url         TEXT NOT NULL,
  overlays    JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_images_vehicle_url
  ON riviamigo.vehicle_images (vehicle_id, url);

CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_placement
  ON riviamigo.vehicle_images (vehicle_id, placement, design, size);
