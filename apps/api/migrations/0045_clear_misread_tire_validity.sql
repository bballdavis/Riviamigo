-- Releases 2026.11.0 and 2026.11.1 read the Parallax tire validity enum
-- backwards: Rivian's 1 means valid, but it was stored as invalid. The
-- corrected decoder sets the flag again on the vehicle's next tire update,
-- but until then a parked vehicle kept showing "Invalid Sensor" over good
-- pressures. The legacy feed never stored an invalid flag, so every false
-- flag on record came from that misread. Clear them to unknown; a genuinely
-- invalid sensor is flagged again by its next update.

UPDATE riviamigo.vehicle_latest_status
SET tire_fl_valid = NULLIF(tire_fl_valid, false),
    tire_fr_valid = NULLIF(tire_fr_valid, false),
    tire_rl_valid = NULLIF(tire_rl_valid, false),
    tire_rr_valid = NULLIF(tire_rr_valid, false)
WHERE tire_fl_valid IS FALSE
   OR tire_fr_valid IS FALSE
   OR tire_rl_valid IS FALSE
   OR tire_rr_valid IS FALSE;
