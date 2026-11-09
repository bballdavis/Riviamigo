-- Additive session lineage: each legacy refresh token starts its own family.
CREATE TABLE riviamigo.session_families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
CREATE INDEX session_families_user_idx ON riviamigo.session_families(user_id);

ALTER TABLE riviamigo.refresh_tokens ADD COLUMN family_id uuid DEFAULT gen_random_uuid();
INSERT INTO riviamigo.session_families (id, user_id, created_at, revoked_at)
SELECT family_id, user_id, created_at, revoked_at FROM riviamigo.refresh_tokens;
ALTER TABLE riviamigo.refresh_tokens ALTER COLUMN family_id DROP DEFAULT;
ALTER TABLE riviamigo.refresh_tokens ALTER COLUMN family_id SET NOT NULL;
ALTER TABLE riviamigo.refresh_tokens ADD CONSTRAINT refresh_tokens_family_fk
    FOREIGN KEY (family_id) REFERENCES riviamigo.session_families(id) ON DELETE CASCADE;
ALTER TABLE riviamigo.refresh_tokens ADD COLUMN consumed_at timestamptz;
ALTER TABLE riviamigo.refresh_tokens ADD COLUMN parent_hash bytea;
CREATE UNIQUE INDEX refresh_tokens_parent_idx ON riviamigo.refresh_tokens(parent_hash)
    WHERE parent_hash IS NOT NULL;
CREATE INDEX refresh_tokens_family_idx ON riviamigo.refresh_tokens(family_id);
