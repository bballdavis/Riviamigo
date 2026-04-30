-- ── cost_profiles ──────────────────────────────────────────────────────────
-- Rate cards used to compute the cost of a charging session.
-- billing_type='per_kwh'  → rate × GREATEST(energy_added, energy_used) + session_fee
-- billing_type='per_minute' → rate × duration_minutes + session_fee
-- billing_type='free'     → cost = 0
-- billing_type='flat'     → rate + session_fee (fixed per session)
CREATE TABLE IF NOT EXISTS riviamigo.cost_profiles (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  billing_type   TEXT         NOT NULL CHECK (billing_type IN ('per_kwh','per_minute','free','flat')),
  rate           FLOAT8        NOT NULL DEFAULT 0,
  session_fee    FLOAT8        NOT NULL DEFAULT 0,
  currency       TEXT         NOT NULL DEFAULT 'USD',
  effective_from DATE,
  effective_to   DATE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cost_profiles_user_idx
  ON riviamigo.cost_profiles (user_id);

-- ── add cost_profile_id to geofences ──────────────────────────────────────────
ALTER TABLE riviamigo.geofences
  ADD COLUMN IF NOT EXISTS cost_profile_id UUID REFERENCES riviamigo.cost_profiles(id);

-- ── add cost_profile_id + home_geofence_id + display_priority + firmware_version to vehicles ──
ALTER TABLE riviamigo.vehicles
  ADD COLUMN IF NOT EXISTS display_priority  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_profile_id   UUID REFERENCES riviamigo.cost_profiles(id),
  ADD COLUMN IF NOT EXISTS home_geofence_id  UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN IF NOT EXISTS firmware_version  TEXT;

-- ── add cost fields to charge_sessions (more columns come in 0013) ────────────
-- cost_profile_id and cost_method will track how cost_usd was computed.
-- If NULL cost_method means cost_usd was set by the old static rate path.
ALTER TABLE riviamigo.charge_sessions
  ADD COLUMN IF NOT EXISTS cost_profile_id  UUID REFERENCES riviamigo.cost_profiles(id),
  ADD COLUMN IF NOT EXISTS cost_method      TEXT;
