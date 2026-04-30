-- ── vehicle_state_periods ──────────────────────────────────────────────────
-- Coarse-grained state history per vehicle.  The ingestion worker writes one
-- open row (ended_at IS NULL) when a new state begins and closes it when the
-- state transitions.  Used by the States Timeline dashboard strip.
CREATE TABLE IF NOT EXISTS riviamigo.vehicle_state_periods (
  id               BIGSERIAL   PRIMARY KEY,
  vehicle_id       UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  state            TEXT        NOT NULL CHECK (state IN
                      ('drive','charging','ready','sleep','offline','updating','unknown')),
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INT         GENERATED ALWAYS AS (
                     CASE WHEN ended_at IS NULL THEN NULL
                          ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::INT END
                   ) STORED
);

-- Fast lookup for the one open period per vehicle (at most one per state machine).
CREATE INDEX IF NOT EXISTS vsp_open_idx
  ON riviamigo.vehicle_state_periods (vehicle_id)
  WHERE ended_at IS NULL;

-- Range queries for timeline dashboard.
CREATE INDEX IF NOT EXISTS vsp_range_idx
  ON riviamigo.vehicle_state_periods (vehicle_id, started_at DESC);

-- ── software_versions ────────────────────────────────────────────────────────
-- Firmware/OTA version history.  One row per version per vehicle.
-- Ingestion worker writes a new row whenever ota_current_version changes.
CREATE TABLE IF NOT EXISTS riviamigo.software_versions (
  id             BIGSERIAL   PRIMARY KEY,
  vehicle_id     UUID        NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  version        TEXT        NOT NULL,
  installed_at   TIMESTAMPTZ NOT NULL,
  observed_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sv_vehicle_idx
  ON riviamigo.software_versions (vehicle_id, installed_at DESC);
