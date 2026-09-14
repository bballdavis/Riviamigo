-- Account deletion is the one lifecycle operation that may remove an owned
-- theme's append-only history.  Keep ordinary revision UPDATE/DELETE calls
-- rejected, while allowing the users route to perform its bounded cleanup in
-- the same transaction as the account deletion.
CREATE OR REPLACE FUNCTION riviamigo.reject_theme_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('riviamigo.allow_theme_revision_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'theme revisions are append-only';
END;
$$;
