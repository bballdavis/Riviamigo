ALTER TABLE timeseries.telemetry
  ADD COLUMN IF NOT EXISTS tire_fl_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_fr_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_rl_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_rr_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS side_bin_left_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS side_bin_right_closed BOOLEAN;

ALTER TABLE riviamigo.vehicle_latest_status
  ADD COLUMN IF NOT EXISTS tire_fl_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_fr_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_rl_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS tire_rr_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS side_bin_left_closed BOOLEAN,
  ADD COLUMN IF NOT EXISTS side_bin_right_closed BOOLEAN;
