CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started
  ON riviamigo.trips(vehicle_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_charge_sessions_vehicle_started
  ON riviamigo.charge_sessions(vehicle_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_sessions_rivian_session
  ON riviamigo.charge_sessions(rivian_session_id)
  WHERE rivian_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON riviamigo.refresh_tokens(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON riviamigo.api_keys(key_hash)
  WHERE revoked_at IS NULL;
