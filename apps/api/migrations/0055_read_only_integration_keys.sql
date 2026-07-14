-- Integration keys are intentionally read-only.  Earlier versions exposed
-- broad verb-based `view`/`edit`/`admin` levels, which allowed an edit key to
-- reach unrelated non-admin mutations and did not enforce its vehicle scope.

UPDATE riviamigo.api_keys
SET access_level = 'read',
    updated_at = now()
WHERE access_level IS DISTINCT FROM 'read';

-- A key without a vehicle cannot meet the integration API's least-privilege
-- contract. Revoke it rather than silently granting every vehicle the user can
-- access; the owner can create an explicitly scoped replacement in Settings.
UPDATE riviamigo.api_keys
SET revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE vehicle_id IS NULL;

ALTER TABLE riviamigo.api_keys
  ALTER COLUMN vehicle_id SET NOT NULL;

ALTER TABLE riviamigo.api_keys
  ALTER COLUMN access_level SET DEFAULT 'read';

ALTER TABLE riviamigo.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_access_level_check;

ALTER TABLE riviamigo.api_keys
  ADD CONSTRAINT api_keys_access_level_check
  CHECK (access_level = 'read');
