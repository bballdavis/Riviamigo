-- Add role column to users for admin gating
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Dashboard configurations table
CREATE TABLE IF NOT EXISTS dashboards (
    id          UUID PRIMARY KEY,
    owner_id    UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
    config      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- NULL owner_id rows (system defaults) share no owner, so slug must be unique among them
    UNIQUE NULLS NOT DISTINCT (owner_id, slug)
);

CREATE INDEX IF NOT EXISTS dashboards_owner_idx ON dashboards (owner_id);
CREATE INDEX IF NOT EXISTS dashboards_slug_idx  ON dashboards (slug);
CREATE INDEX IF NOT EXISTS dashboards_default_idx ON dashboards (is_default) WHERE is_default = TRUE;
