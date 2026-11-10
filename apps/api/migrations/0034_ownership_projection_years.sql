-- Ownership dashboard: how many years of ownership the Projected view covers,
-- counted from the purchase date. NULL uses the default of five years.

ALTER TABLE riviamigo.vehicle_ownership_settings
    ADD COLUMN projection_years smallint,
    ADD CONSTRAINT vehicle_ownership_projection_years_check
        CHECK (projection_years IS NULL OR (projection_years >= 1 AND projection_years <= 20));
