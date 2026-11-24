-- Charging power the vehicle measures, kept as a series.
--
-- Parallax sends `charging.session.power` about every five seconds and repeats
-- the power in `charge_session_breakdown` about every 30 seconds. Until now only
-- the latest value reached the charge session row, so the charge curve fell
-- back to estimating power from battery-level steps, which are too coarse for
-- a one-minute rate and produced false spikes (issue #126).
--
-- `parallax_charge_power_samples` holds `charging.session.power`. The collector
-- thins it to about one reading every 15 seconds (sooner when the power moves)
-- and writes a zero when the vehicle reports that power stopped flowing. The
-- curve reads it by vehicle and time window, so a reading still counts when
-- session association is missing or a repair later merges the session;
-- `charge_session_id` is kept for diagnostics.

CREATE TABLE IF NOT EXISTS timeseries.parallax_charge_power_samples (
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    source_at timestamptz NOT NULL,
    power_kw double precision NOT NULL CHECK (power_kw >= 0 AND power_kw <= 500),
    charge_session_id uuid REFERENCES riviamigo.charge_sessions(id) ON DELETE SET NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (vehicle_id, source_at)
);

-- The breakdown already stores the vehicle's running energy total; its power
-- reading is stored beside it, only while power is flowing. The existing
-- (vehicle_id, source_at) index serves the curve's time-window reads.
ALTER TABLE timeseries.parallax_charge_breakdown_samples
    ADD COLUMN IF NOT EXISTS power_kw double precision;
