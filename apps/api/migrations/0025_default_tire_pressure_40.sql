-- Lower the default target tire pressure for newly created vehicles.
-- Existing rows keep their stored value.
ALTER TABLE riviamigo.vehicles ALTER COLUMN target_tire_pressure_psi SET DEFAULT 40;
