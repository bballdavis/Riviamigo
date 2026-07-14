-- Vehicle artwork is retrieved with the authenticated Rivian account, not as a
-- separate third-party integration. Retire the legacy independent control.
DELETE FROM riviamigo.external_connection_activity
WHERE connection_id = 'rivian_artwork';

DELETE FROM riviamigo.external_connection_settings
WHERE id = 'rivian_artwork';

-- The manifest lives in vehicle_images while the blobs live on the persistent
-- API data volume. This state makes background repair observable and prevents
-- a missing blob from triggering an upstream request during a browser render.
CREATE TABLE IF NOT EXISTS riviamigo.vehicle_artwork_cache_state (
  vehicle_id              UUID PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'pending',
  asset_count             INTEGER NOT NULL DEFAULT 0,
  ready_asset_count       INTEGER NOT NULL DEFAULT 0,
  attempts                INTEGER NOT NULL DEFAULT 0,
  next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_repair_attempt_at  TIMESTAMPTZ,
  last_repair_success_at  TIMESTAMPTZ,
  last_error              TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_artwork_cache_state_status_check
    CHECK (status IN ('pending', 'repairing', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS vehicle_artwork_cache_state_next_attempt_idx
  ON riviamigo.vehicle_artwork_cache_state (status, next_attempt_at);
