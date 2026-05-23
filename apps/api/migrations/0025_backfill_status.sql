-- Migration 0025: Backfill status tracking + charge session source
-- Tracks whether a vehicle has had its full Rivian charge history backfilled.
-- Also records where each charge session came from (local telemetry vs. Rivian API).

-- Backfill status on vehicles
ALTER TABLE riviamigo.vehicles
    ADD COLUMN IF NOT EXISTS history_backfilled_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS history_backfill_status  TEXT,  -- 'pending' | 'running' | 'done' | 'error'
    ADD COLUMN IF NOT EXISTS history_session_count    INT;

-- Source tracking on charge sessions (allows distinguishing telemetry-detected vs API-synced)
ALTER TABLE riviamigo.charge_sessions
    ADD COLUMN IF NOT EXISTS source TEXT;  -- 'telemetry' | 'rivian_api'

-- Index to quickly find sessions from each source
CREATE INDEX IF NOT EXISTS charge_sessions_source_idx
    ON riviamigo.charge_sessions (vehicle_id, source)
    WHERE source IS NOT NULL;
