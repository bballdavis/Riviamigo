ALTER TABLE riviamigo.vehicle_runtime_state
  ADD COLUMN IF NOT EXISTS last_seen_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payload_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_persisted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS riviamigo.rivian_ws_raw_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type  TEXT NOT NULL,
  message_type TEXT,
  payload_json JSONB,
  payload_text TEXT
);

CREATE INDEX IF NOT EXISTS rivian_ws_raw_events_vehicle_received_idx
  ON riviamigo.rivian_ws_raw_events (vehicle_id, received_at DESC);

CREATE INDEX IF NOT EXISTS rivian_ws_raw_events_received_idx
  ON riviamigo.rivian_ws_raw_events (received_at);

CREATE TABLE IF NOT EXISTS riviamigo.rivian_stewardship_counters (
  vehicle_id UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  ws_messages_received BIGINT NOT NULL DEFAULT 0,
  ws_heartbeats_received BIGINT NOT NULL DEFAULT 0,
  ws_payload_messages_received BIGINT NOT NULL DEFAULT 0,
  ws_control_messages_received BIGINT NOT NULL DEFAULT 0,
  ws_connections_opened BIGINT NOT NULL DEFAULT 0,
  ws_reconnects BIGINT NOT NULL DEFAULT 0,
  outbound_messages_sent BIGINT NOT NULL DEFAULT 0,
  outbound_graphql_requests BIGINT NOT NULL DEFAULT 0,
  telemetry_writes_persisted BIGINT NOT NULL DEFAULT 0,
  telemetry_writes_suppressed BIGINT NOT NULL DEFAULT 0,
  telemetry_suppressed_duplicate BIGINT NOT NULL DEFAULT 0,
  telemetry_suppressed_empty BIGINT NOT NULL DEFAULT 0,
  telemetry_suppressed_threshold BIGINT NOT NULL DEFAULT 0,
  collector_lock_skips BIGINT NOT NULL DEFAULT 0,
  raw_events_persisted BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, day)
);

CREATE INDEX IF NOT EXISTS rivian_stewardship_counters_day_idx
  ON riviamigo.rivian_stewardship_counters (day DESC);
