-- Rivian reports tirePressure* values in BAR. Early Riviamigo builds stored
-- those raw values in *_psi columns, which made dashboard tires show ~3 psi.
UPDATE timeseries.telemetry
SET
  tire_fl_psi = CASE WHEN tire_fl_psi BETWEEN 1 AND 8 THEN tire_fl_psi * 14.5037738 ELSE tire_fl_psi END,
  tire_fr_psi = CASE WHEN tire_fr_psi BETWEEN 1 AND 8 THEN tire_fr_psi * 14.5037738 ELSE tire_fr_psi END,
  tire_rl_psi = CASE WHEN tire_rl_psi BETWEEN 1 AND 8 THEN tire_rl_psi * 14.5037738 ELSE tire_rl_psi END,
  tire_rr_psi = CASE WHEN tire_rr_psi BETWEEN 1 AND 8 THEN tire_rr_psi * 14.5037738 ELSE tire_rr_psi END
WHERE tire_fl_psi BETWEEN 1 AND 8
   OR tire_fr_psi BETWEEN 1 AND 8
   OR tire_rl_psi BETWEEN 1 AND 8
   OR tire_rr_psi BETWEEN 1 AND 8;
