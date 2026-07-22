ALTER TABLE riviamigo.backup_settings
    ADD COLUMN local_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN s3_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE riviamigo.backup_artifacts
    ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE riviamigo.backup_artifacts
    DROP CONSTRAINT IF EXISTS backup_artifacts_run_id_key;

ALTER TABLE riviamigo.backup_artifacts
    DROP CONSTRAINT IF EXISTS backup_artifacts_storage_type_check;

ALTER TABLE riviamigo.backup_artifacts
    ADD CONSTRAINT backup_artifacts_storage_type_check
    CHECK (storage_type = ANY (ARRAY['local'::text, 'uploaded'::text, 'safety'::text, 's3'::text]));

CREATE UNIQUE INDEX backup_artifacts_s3_locator_unique
    ON riviamigo.backup_artifacts (storage_path)
    WHERE storage_type = 's3';
