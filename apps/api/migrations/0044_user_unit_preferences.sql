ALTER TABLE riviamigo.user_preferences
  ADD COLUMN IF NOT EXISTS unit_mode TEXT NOT NULL DEFAULT 'imperial',
  ADD COLUMN IF NOT EXISTS custom_distance_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_speed_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_temperature_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_pressure_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_altitude_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_place_radius_unit TEXT,
  ADD COLUMN IF NOT EXISTS custom_efficiency_display TEXT;

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_unit_mode_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_unit_mode_check
  CHECK (unit_mode IN ('imperial', 'metric', 'custom'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_distance_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_distance_unit_check
  CHECK (custom_distance_unit IS NULL OR custom_distance_unit IN ('miles', 'kilometers'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_speed_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_speed_unit_check
  CHECK (custom_speed_unit IS NULL OR custom_speed_unit IN ('mph', 'kmh'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_temperature_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_temperature_unit_check
  CHECK (custom_temperature_unit IS NULL OR custom_temperature_unit IN ('fahrenheit', 'celsius'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_pressure_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_pressure_unit_check
  CHECK (custom_pressure_unit IS NULL OR custom_pressure_unit IN ('psi', 'kpa'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_altitude_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_altitude_unit_check
  CHECK (custom_altitude_unit IS NULL OR custom_altitude_unit IN ('feet', 'meters'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_place_radius_unit_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_place_radius_unit_check
  CHECK (custom_place_radius_unit IS NULL OR custom_place_radius_unit IN ('feet', 'meters'));

ALTER TABLE riviamigo.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_custom_efficiency_display_check;
ALTER TABLE riviamigo.user_preferences
  ADD CONSTRAINT user_preferences_custom_efficiency_display_check
  CHECK (
    custom_efficiency_display IS NULL
    OR custom_efficiency_display IN ('distance_per_energy', 'energy_per_distance')
  );
