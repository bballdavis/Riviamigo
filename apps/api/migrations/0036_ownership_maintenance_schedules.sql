-- Ownership dashboard: maintenance schedules the owner has edited, keyed by
-- the vehicle they apply to ('own' for the tracked vehicle, a reference
-- vehicle id, or an added vehicle's id). A vehicle without an entry uses its
-- built-in schedule.

ALTER TABLE riviamigo.vehicle_ownership_settings
    ADD COLUMN maintenance jsonb NOT NULL DEFAULT '{}'::jsonb;
