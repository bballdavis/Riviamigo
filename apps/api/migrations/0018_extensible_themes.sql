CREATE TABLE riviamigo.user_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    base_theme_id TEXT NOT NULL,
    published_revision INTEGER,
    etag_version BIGINT NOT NULL DEFAULT 1,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_themes_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT user_themes_base_builtin CHECK (base_theme_id = ANY (ARRAY['classic'::text, 'rad'::text])),
    CONSTRAINT user_themes_etag_positive CHECK (etag_version > 0),
    CONSTRAINT user_themes_published_revision_positive CHECK (published_revision IS NULL OR published_revision > 0)
);

CREATE INDEX user_themes_owner_active_idx
    ON riviamigo.user_themes (owner_id, updated_at DESC)
    WHERE retired_at IS NULL;

CREATE TABLE riviamigo.user_theme_revisions (
    theme_id UUID NOT NULL REFERENCES riviamigo.user_themes(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL,
    definition JSONB NOT NULL,
    definition_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (theme_id, revision),
    CONSTRAINT user_theme_revisions_revision_positive CHECK (revision > 0),
    CONSTRAINT user_theme_revisions_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT user_theme_revisions_definition_size CHECK (pg_column_size(definition) <= 65536),
    CONSTRAINT user_theme_revisions_hash_format CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE riviamigo.user_themes
    ADD CONSTRAINT user_themes_published_revision_fk
    FOREIGN KEY (id, published_revision)
    REFERENCES riviamigo.user_theme_revisions(theme_id, revision)
    DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION riviamigo.reject_theme_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'theme revisions are append-only';
END;
$$;

CREATE TRIGGER user_theme_revisions_append_only
    BEFORE UPDATE OR DELETE ON riviamigo.user_theme_revisions
    FOR EACH ROW EXECUTE FUNCTION riviamigo.reject_theme_revision_mutation();

CREATE TABLE riviamigo.user_theme_publications (
    theme_id UUID NOT NULL,
    revision INTEGER NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (theme_id, revision),
    FOREIGN KEY (theme_id, revision)
        REFERENCES riviamigo.user_theme_revisions(theme_id, revision)
        ON DELETE RESTRICT
);

ALTER TABLE riviamigo.user_preferences
    ADD COLUMN theme_selection_kind TEXT NOT NULL DEFAULT 'builtin',
    ADD COLUMN theme_builtin_id TEXT NOT NULL DEFAULT 'classic',
    ADD COLUMN theme_custom_id UUID,
    ADD COLUMN theme_custom_revision INTEGER,
    ADD COLUMN theme_etag_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE riviamigo.user_preferences
    ADD CONSTRAINT user_preferences_theme_selection_kind_check
        CHECK (theme_selection_kind = ANY (ARRAY['builtin'::text, 'custom'::text])),
    ADD CONSTRAINT user_preferences_theme_builtin_id_check
        CHECK (theme_builtin_id = ANY (ARRAY['classic'::text, 'rad'::text])),
    ADD CONSTRAINT user_preferences_theme_etag_positive
        CHECK (theme_etag_version > 0),
    ADD CONSTRAINT user_preferences_theme_selection_shape_check
        CHECK (
            (
                theme_selection_kind = 'builtin'
                AND theme_custom_id IS NULL
                AND theme_custom_revision IS NULL
                AND theme_builtin_id = theme_palette
            )
            OR
            (
                theme_selection_kind = 'custom'
                AND theme_custom_id IS NOT NULL
                AND theme_custom_revision IS NOT NULL
                AND theme_custom_revision > 0
            )
        ),
    ADD CONSTRAINT user_preferences_theme_custom_revision_fk
        FOREIGN KEY (theme_custom_id, theme_custom_revision)
        REFERENCES riviamigo.user_theme_revisions(theme_id, revision)
        DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION riviamigo.project_legacy_theme_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Rollback binaries know only theme_palette. A changed legacy palette must
    -- switch to that built-in, while a mode-only write of the current projected
    -- palette preserves a pinned custom selection.
    IF NEW.theme_palette IS DISTINCT FROM OLD.theme_palette
       AND NEW.theme_selection_kind IS NOT DISTINCT FROM OLD.theme_selection_kind
       AND NEW.theme_builtin_id IS NOT DISTINCT FROM OLD.theme_builtin_id
       AND NEW.theme_custom_id IS NOT DISTINCT FROM OLD.theme_custom_id
       AND NEW.theme_custom_revision IS NOT DISTINCT FROM OLD.theme_custom_revision THEN
        NEW.theme_selection_kind := 'builtin';
        NEW.theme_builtin_id := NEW.theme_palette;
        NEW.theme_custom_id := NULL;
        NEW.theme_custom_revision := NULL;
        NEW.theme_etag_version := OLD.theme_etag_version + 1;
    ELSIF NEW.theme_mode IS DISTINCT FROM OLD.theme_mode
       AND NEW.theme_selection_kind IS NOT DISTINCT FROM OLD.theme_selection_kind
       AND NEW.theme_builtin_id IS NOT DISTINCT FROM OLD.theme_builtin_id
       AND NEW.theme_custom_id IS NOT DISTINCT FROM OLD.theme_custom_id
       AND NEW.theme_custom_revision IS NOT DISTINCT FROM OLD.theme_custom_revision
       AND NEW.theme_etag_version IS NOT DISTINCT FROM OLD.theme_etag_version THEN
        NEW.theme_etag_version := OLD.theme_etag_version + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_preferences_project_legacy_theme_write
    BEFORE UPDATE ON riviamigo.user_preferences
    FOR EACH ROW EXECUTE FUNCTION riviamigo.project_legacy_theme_write();
