-- ── service_events ───────────────────────────────────────────────────────────
-- Manual service / maintenance log entries entered by the user.
-- Event types are open-ended text (not enumerated) so users can record
-- anything: 'tire_rotation', 'wiper_replacement', 'recall', 'wash', etc.
CREATE TABLE IF NOT EXISTS riviamigo.service_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL,
  odometer_mi  FLOAT8,
  cost_usd     FLOAT8,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_events_vehicle_idx
  ON riviamigo.service_events (vehicle_id, performed_at DESC);
