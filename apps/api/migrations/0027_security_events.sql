CREATE TABLE IF NOT EXISTS riviamigo.security_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  TEXT        NOT NULL,
    user_id     UUID        REFERENCES riviamigo.users(id) ON DELETE SET NULL,
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_user_created_idx
    ON riviamigo.security_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_created_idx
    ON riviamigo.security_events (event_type, created_at DESC);