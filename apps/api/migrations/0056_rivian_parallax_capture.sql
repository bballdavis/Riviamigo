-- Experimental, read-only Parallax capture. Keep this separate from the
-- production telemetry model so the data can be dropped after schema review.
-- trip_id and charge_session_id intentionally have no foreign keys: the
-- ingestion worker creates those IDs while a drive/session is active and only
-- persists the parent row when it closes.
CREATE TABLE IF NOT EXISTS riviamigo.rivian_parallax_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  trip_id             UUID,
  charge_session_id   UUID,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  server_timestamp    TIMESTAMPTZ,
  rvm                 TEXT NOT NULL,
  payload_b64         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rivian_parallax_events_vehicle_received_idx
  ON riviamigo.rivian_parallax_events (vehicle_id, received_at DESC);

CREATE INDEX IF NOT EXISTS rivian_parallax_events_trip_received_idx
  ON riviamigo.rivian_parallax_events (trip_id, received_at)
  WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rivian_parallax_events_rvm_received_idx
  ON riviamigo.rivian_parallax_events (rvm, received_at DESC);

ALTER TABLE riviamigo.rivian_stewardship_counters
  ADD COLUMN IF NOT EXISTS parallax_events_persisted BIGINT NOT NULL DEFAULT 0;
