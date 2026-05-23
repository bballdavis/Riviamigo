-- Rivian enrichment upserts touch vehicles.updated_at.

ALTER TABLE riviamigo.vehicles
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
