-- Rename the legacy demo in place. Its UUID remains unchanged, so memberships,
-- telemetry, trips, dashboard assignments, and other references stay attached.
UPDATE riviamigo.vehicle_user_settings settings
SET display_name = 'Demo R2', updated_at = now()
FROM riviamigo.vehicles vehicle
WHERE settings.vehicle_id = vehicle.id
  AND vehicle.rivian_vehicle_id = 'demo-r2s-local'
  AND settings.display_name = 'Demo R2S';

-- Change only labels that are exactly the old model name. Keep owner nicknames.
UPDATE riviamigo.vehicle_user_settings settings
SET display_name = 'R2', updated_at = now()
FROM riviamigo.vehicles vehicle
WHERE settings.vehicle_id = vehicle.id
  AND upper(trim(vehicle.model)) IN ('R2', 'R2S', 'R2-S')
  AND upper(trim(settings.display_name)) IN ('R2S', 'R2-S');

UPDATE riviamigo.vehicles
SET model = 'R2',
    name = CASE
        WHEN rivian_vehicle_id = 'demo-r2s-local' AND name = 'Demo R2S' THEN 'Demo R2'
        WHEN upper(trim(name)) IN ('R2S', 'R2-S') THEN 'R2'
        ELSE name
    END,
    battery_config = CASE WHEN lower(trim(battery_config)) = 'r2s' THEN 'r2' ELSE battery_config END,
    rivian_vehicle_id = CASE WHEN rivian_vehicle_id = 'demo-r2s-local' THEN 'demo-r2-local' ELSE rivian_vehicle_id END
WHERE upper(trim(model)) IN ('R2', 'R2S', 'R2-S') OR rivian_vehicle_id = 'demo-r2s-local';

ALTER TABLE riviamigo.vehicles
ADD CONSTRAINT vehicles_r2_model_canonical
CHECK (upper(trim(model)) NOT IN ('R2S', 'R2-S'));

CREATE TABLE riviamigo.vehicle_ingestion_diagnostics (
    vehicle_id uuid PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    enabled_until timestamptz NOT NULL,
    enabled_by uuid REFERENCES riviamigo.users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
