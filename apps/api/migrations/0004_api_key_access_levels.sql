ALTER TABLE riviamigo.api_keys
  ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'view',
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE riviamigo.api_keys
SET name = COALESCE(name, label)
WHERE name IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'api_keys_access_level_check'
      AND conrelid = 'riviamigo.api_keys'::regclass
  ) THEN
    ALTER TABLE riviamigo.api_keys
      ADD CONSTRAINT api_keys_access_level_check
      CHECK (access_level IN ('view', 'edit', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS api_keys_vehicle_active_idx
  ON riviamigo.api_keys (vehicle_id, created_at DESC)
  WHERE revoked_at IS NULL;
