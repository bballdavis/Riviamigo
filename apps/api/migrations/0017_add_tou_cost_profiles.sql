ALTER TABLE riviamigo.cost_profiles
  DROP CONSTRAINT IF EXISTS cost_profiles_billing_type_check;

ALTER TABLE riviamigo.cost_profiles
  ADD COLUMN IF NOT EXISTS timezone   TEXT,
  ADD COLUMN IF NOT EXISTS tou_periods JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE riviamigo.cost_profiles
  ADD CONSTRAINT cost_profiles_billing_type_check
  CHECK (billing_type IN ('per_kwh','per_minute','free','flat','tou'));

CREATE INDEX IF NOT EXISTS cost_profiles_tou_gin_idx
  ON riviamigo.cost_profiles USING gin (tou_periods);