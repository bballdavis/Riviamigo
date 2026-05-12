CREATE TABLE IF NOT EXISTS riviamigo.backup_artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL UNIQUE REFERENCES riviamigo.backup_runs(id) ON DELETE CASCADE,
  storage_type    TEXT NOT NULL DEFAULT 'local',
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  manifest        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backup_artifacts_storage_type_check CHECK (storage_type IN ('local'))
);

CREATE INDEX IF NOT EXISTS backup_artifacts_created_idx
  ON riviamigo.backup_artifacts (created_at DESC);

CREATE INDEX IF NOT EXISTS backup_artifacts_run_idx
  ON riviamigo.backup_artifacts (run_id);

CREATE TABLE IF NOT EXISTS riviamigo.backup_restore_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id         UUID NOT NULL REFERENCES riviamigo.backup_artifacts(id) ON DELETE CASCADE,
  requested_by        UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  confirmation_phrase TEXT NOT NULL,
  notes               TEXT,
  error_message       TEXT,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backup_restore_requests_status_check CHECK (status IN ('pending', 'approved', 'running', 'completed', 'failed', 'canceled'))
);

CREATE INDEX IF NOT EXISTS backup_restore_requests_requested_idx
  ON riviamigo.backup_restore_requests (requested_at DESC);

CREATE INDEX IF NOT EXISTS backup_restore_requests_artifact_idx
  ON riviamigo.backup_restore_requests (artifact_id, status);