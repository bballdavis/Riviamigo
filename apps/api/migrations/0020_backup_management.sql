CREATE TABLE IF NOT EXISTS riviamigo.backup_settings (
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  frequency           TEXT NOT NULL DEFAULT 'weekly',
  run_at              TIME NOT NULL DEFAULT TIME '03:00',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  day_of_week         SMALLINT,
  day_of_month        SMALLINT,
  retention_count     INTEGER NOT NULL DEFAULT 8,
  target_type         TEXT NOT NULL DEFAULT 's3',
  endpoint            TEXT NOT NULL DEFAULT '',
  region              TEXT,
  bucket              TEXT NOT NULL DEFAULT '',
  prefix              TEXT NOT NULL DEFAULT 'riviamigo',
  access_key          TEXT,
  secret_key_encrypted BYTEA,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS riviamigo.backup_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       TEXT NOT NULL DEFAULT 'manual',
  status        TEXT NOT NULL DEFAULT 'pending',
  requested_by  UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL,
  artifact_key  TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT backup_settings_frequency_check CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT backup_settings_target_type_check CHECK (target_type IN ('s3')),
  CONSTRAINT backup_settings_day_of_week_check CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  CONSTRAINT backup_settings_day_of_month_check CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  CONSTRAINT backup_settings_retention_check CHECK (retention_count >= 1),
  CONSTRAINT backup_runs_trigger_check CHECK (trigger IN ('manual', 'scheduled', 'restore')),
  CONSTRAINT backup_runs_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled'))
);

CREATE INDEX IF NOT EXISTS backup_runs_created_idx
  ON riviamigo.backup_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS backup_runs_status_idx
  ON riviamigo.backup_runs (status, created_at DESC);