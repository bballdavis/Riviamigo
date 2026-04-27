CREATE TABLE timeseries.telemetry (
  ts                         TIMESTAMPTZ NOT NULL,
  vehicle_id                 UUID NOT NULL,
  latitude                   FLOAT8,
  longitude                  FLOAT8,
  altitude_m                 FLOAT8,
  speed_mph                  FLOAT8,
  battery_level              FLOAT8,
  battery_capacity_wh        FLOAT8,
  distance_to_empty_mi       FLOAT8,
  battery_limit              FLOAT8,
  power_state                TEXT,
  charger_state              TEXT,
  charger_status             TEXT,
  time_to_end_of_charge_min  INT,
  drive_mode                 TEXT,
  gear_status                TEXT,
  cabin_temp_c               FLOAT8,
  driver_temp_c              FLOAT8,
  odometer_miles             FLOAT8,
  hv_thermal_event           TEXT,
  twelve_volt_health         TEXT,
  is_online                  BOOLEAN
);

SELECT create_hypertable('timeseries.telemetry', 'ts',
  chunk_time_interval => INTERVAL '1 week');

SELECT add_compression_policy('timeseries.telemetry', INTERVAL '30 days');

CREATE INDEX ON timeseries.telemetry (vehicle_id, ts DESC);
CREATE INDEX ON timeseries.telemetry (vehicle_id, power_state, ts DESC)
  WHERE power_state IS NOT NULL;
CREATE INDEX ON timeseries.telemetry (vehicle_id, charger_state, ts DESC)
  WHERE charger_state IS NOT NULL;
