-- Rivian marks every tire reading "not valid" once a vehicle parks and its
-- wheel sensors go quiet. Releases up to 2026.11.2 stored that as a failed
-- sensor, so a parked vehicle showed "Invalid Sensor" over good pressures.
-- Ingestion now ignores the flag unless the vehicle is being driven, but a
-- parked vehicle sends nothing that would correct the flags already stored.
-- Clear them to unknown so the last measured pressures show again; a sensor
-- that really fails is flagged again on the next drive.

UPDATE riviamigo.vehicle_latest_status
SET tire_fl_valid = NULLIF(tire_fl_valid, false),
    tire_fr_valid = NULLIF(tire_fr_valid, false),
    tire_rl_valid = NULLIF(tire_rl_valid, false),
    tire_rr_valid = NULLIF(tire_rr_valid, false)
WHERE tire_fl_valid IS FALSE
   OR tire_fr_valid IS FALSE
   OR tire_rl_valid IS FALSE
   OR tire_rr_valid IS FALSE;
