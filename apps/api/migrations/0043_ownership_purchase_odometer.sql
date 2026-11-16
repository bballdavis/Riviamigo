-- Ownership dashboard: the odometer reading when the owner bought the
-- vehicle. Miles driven under this owner are the current odometer minus this
-- reading. NULL means the vehicle was bought new, at zero miles.

ALTER TABLE riviamigo.vehicle_ownership_settings
    ADD COLUMN purchase_odometer_mi double precision,
    ADD CONSTRAINT vehicle_ownership_purchase_odometer_check
        CHECK (purchase_odometer_mi IS NULL OR (purchase_odometer_mi >= 0 AND purchase_odometer_mi <= 2000000));
