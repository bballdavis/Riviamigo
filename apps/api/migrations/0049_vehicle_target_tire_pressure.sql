ALTER TABLE riviamigo.vehicles
ADD COLUMN IF NOT EXISTS target_tire_pressure_psi FLOAT8;

UPDATE riviamigo.vehicles
SET target_tire_pressure_psi = 48
WHERE target_tire_pressure_psi IS NULL;

ALTER TABLE riviamigo.vehicles
ALTER COLUMN target_tire_pressure_psi SET DEFAULT 48;
