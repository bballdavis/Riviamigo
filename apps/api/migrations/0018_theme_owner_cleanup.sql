-- Preserve append-only revisions during normal theme lifecycle operations while
-- allowing PostgreSQL's bounded owner cascade to remove an account's history.
-- Direct theme deletion remains rejected while its owning account exists.

ALTER TABLE riviamigo.user_theme_publications
    DROP CONSTRAINT user_theme_publications_theme_id_revision_fkey,
    ADD CONSTRAINT user_theme_publications_theme_id_revision_fkey
        FOREIGN KEY (theme_id, revision)
        REFERENCES riviamigo.user_theme_revisions(theme_id, revision)
        ON DELETE CASCADE;

ALTER TABLE riviamigo.user_theme_revisions
    DROP CONSTRAINT user_theme_revisions_theme_id_fkey,
    ADD CONSTRAINT user_theme_revisions_theme_id_fkey
        FOREIGN KEY (theme_id)
        REFERENCES riviamigo.user_themes(id)
        ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION riviamigo.reject_theme_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (
           SELECT 1 FROM riviamigo.user_themes WHERE id = OLD.theme_id
       ) THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'theme revisions are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION riviamigo.reject_direct_theme_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM riviamigo.users WHERE id = OLD.owner_id
    ) THEN
        RAISE EXCEPTION 'themes must be retired; only account deletion removes history';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER user_themes_account_delete_only
    BEFORE DELETE ON riviamigo.user_themes
    FOR EACH ROW EXECUTE FUNCTION riviamigo.reject_direct_theme_delete();
