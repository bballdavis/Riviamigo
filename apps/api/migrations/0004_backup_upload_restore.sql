ALTER TABLE riviamigo.backup_runs
    DROP CONSTRAINT IF EXISTS backup_runs_trigger_check;

ALTER TABLE riviamigo.backup_runs
    ADD CONSTRAINT backup_runs_trigger_check
    CHECK (trigger = ANY (ARRAY['manual'::text, 'scheduled'::text, 'restore'::text, 'upload'::text, 'pre_restore'::text]));

ALTER TABLE riviamigo.backup_artifacts
    DROP CONSTRAINT IF EXISTS backup_artifacts_storage_type_check;

ALTER TABLE riviamigo.backup_artifacts
    ADD CONSTRAINT backup_artifacts_storage_type_check
    CHECK (storage_type = ANY (ARRAY['local'::text, 'uploaded'::text, 'safety'::text]));
