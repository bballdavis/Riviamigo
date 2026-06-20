ALTER TABLE riviamigo.vehicle_latest_status
  ADD COLUMN IF NOT EXISTS battery_level_ts              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distance_to_empty_mi_ts       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS battery_limit_ts              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS power_state_ts                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS charger_status_ts             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_to_end_of_charge_min_ts  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_ts                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS speed_mph_ts                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS odometer_miles_ts            TIMESTAMPTZ;

UPDATE riviamigo.vehicle_latest_status
   SET battery_level_ts = COALESCE(
         battery_level_ts,
         CASE WHEN battery_level IS NOT NULL THEN ts END
       ),
       distance_to_empty_mi_ts = COALESCE(
         distance_to_empty_mi_ts,
         CASE WHEN distance_to_empty_mi IS NOT NULL THEN ts END
       ),
       battery_limit_ts = COALESCE(
         battery_limit_ts,
         CASE WHEN battery_limit IS NOT NULL THEN ts END
       ),
       power_state_ts = COALESCE(
         power_state_ts,
         CASE WHEN power_state IS NOT NULL THEN ts END
       ),
       charger_status_ts = COALESCE(
         charger_status_ts,
         CASE WHEN charger_status IS NOT NULL THEN COALESCE(charger_state_ts, ts) END
       ),
       time_to_end_of_charge_min_ts = COALESCE(
         time_to_end_of_charge_min_ts,
         CASE WHEN time_to_end_of_charge_min IS NOT NULL THEN COALESCE(charger_state_ts, ts) END
       ),
       location_ts = COALESCE(
         location_ts,
         CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN ts END
       ),
       speed_mph_ts = COALESCE(
         speed_mph_ts,
         CASE WHEN speed_mph IS NOT NULL THEN ts END
       ),
       odometer_miles_ts = COALESCE(
         odometer_miles_ts,
         CASE WHEN odometer_miles IS NOT NULL THEN ts END
       );

ALTER TABLE riviamigo.vehicle_runtime_state
  ADD COLUMN IF NOT EXISTS last_ws_received_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ws_payload_received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ws_heartbeat_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_charge_history_sync_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_charge_history_success_at TIMESTAMPTZ;

UPDATE riviamigo.vehicle_runtime_state
   SET last_ws_received_at = COALESCE(last_ws_received_at, last_seen_at, last_event_at),
       last_ws_payload_received_at = COALESCE(last_ws_payload_received_at, last_payload_at),
       last_ws_heartbeat_received_at = COALESCE(last_ws_heartbeat_received_at, last_heartbeat_at);
