CREATE TABLE riviamigo.charts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES riviamigo.users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL,
    baseline_revision INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT charts_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9._-]*$'),
    CONSTRAINT charts_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    CONSTRAINT charts_config_object CHECK (jsonb_typeof(config) = 'object'),
    CONSTRAINT charts_system_default_owner CHECK (owner_id IS NOT NULL OR is_default = TRUE),
    CONSTRAINT charts_baseline_revision_nonnegative CHECK (baseline_revision IS NULL OR baseline_revision >= 0)
);

CREATE UNIQUE INDEX charts_system_slug_idx
    ON riviamigo.charts (slug)
    WHERE owner_id IS NULL;

CREATE UNIQUE INDEX charts_owner_slug_idx
    ON riviamigo.charts (owner_id, slug)
    WHERE owner_id IS NOT NULL;

CREATE INDEX charts_owner_enabled_idx
    ON riviamigo.charts (owner_id, is_enabled, slug);
