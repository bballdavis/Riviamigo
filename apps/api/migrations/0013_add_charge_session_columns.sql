-- Extended columns for charge_sessions table.
-- All new columns are nullable so existing rows are unaffected.

ALTER TABLE riviamigo.charge_sessions
  -- energy_used_wh: meter-energy integrated from power_kw × Δt during the session.
  -- Separate from energy_added_wh (SOC-delta × pack capacity) because
  -- charging efficiency = energy_added_wh / GREATEST(energy_added_wh, energy_used_wh).
  ADD COLUMN IF NOT EXISTS energy_added_wh     FLOAT8,
  ADD COLUMN IF NOT EXISTS energy_used_wh      FLOAT8,

  -- Average charge rate for the session (kW).
  ADD COLUMN IF NOT EXISTS avg_charge_rate_kw  FLOAT8,

  -- Peak voltage recorded during the session (informational).
  ADD COLUMN IF NOT EXISTS peak_voltage        FLOAT8,

  -- Geofence + address linkage (where was the vehicle charged).
  ADD COLUMN IF NOT EXISTS geofence_id         UUID REFERENCES riviamigo.geofences(id),
  ADD COLUMN IF NOT EXISTS address_id          UUID REFERENCES riviamigo.addresses(id);

CREATE INDEX IF NOT EXISTS cs_geofence_idx
  ON riviamigo.charge_sessions (geofence_id)
  WHERE geofence_id IS NOT NULL;
