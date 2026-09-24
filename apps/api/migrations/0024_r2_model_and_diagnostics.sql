-- Keep the legacy demo identity stable so existing membership and history stay attached.
UPDATE riviamigo.vehicles
SET model = 'R2',
    name = CASE WHEN rivian_vehicle_id = 'demo-r2s-local' AND name = 'Demo R2S' THEN 'Demo R2' ELSE name END,
    battery_config = CASE WHEN rivian_vehicle_id = 'demo-r2s-local' AND battery_config = 'r2s' THEN 'r2' ELSE battery_config END
WHERE model IN ('R2S', 'R2-S');

UPDATE riviamigo.vehicle_user_settings settings
SET display_name = 'Demo R2', updated_at = now()
FROM riviamigo.vehicles vehicle
WHERE settings.vehicle_id = vehicle.id
  AND vehicle.rivian_vehicle_id = 'demo-r2s-local'
  AND settings.display_name = 'Demo R2S';

CREATE TABLE riviamigo.vehicle_ingestion_diagnostics (
    vehicle_id uuid PRIMARY KEY REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    enabled_until timestamptz NOT NULL,
    enabled_by uuid REFERENCES riviamigo.users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
