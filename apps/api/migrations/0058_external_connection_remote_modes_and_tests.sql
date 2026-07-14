ALTER TABLE riviamigo.external_connection_settings
  DROP CONSTRAINT IF EXISTS external_connection_mode_check;

UPDATE riviamigo.external_connection_settings
SET mode = 'remote'
WHERE mode = 'hosted';

ALTER TABLE riviamigo.external_connection_settings
  ALTER COLUMN mode SET DEFAULT 'remote',
  ADD CONSTRAINT external_connection_mode_check
    CHECK (mode IN ('remote', 'custom', 'disabled'));

ALTER TABLE riviamigo.external_connection_activity
  ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT,
  ADD COLUMN IF NOT EXISTS last_test_checks JSONB;
