-- Owner-started ingestion captures. The diagnostics row now describes the
-- vehicle's most recent capture and survives Stop so its events can be
-- downloaded; starting a new capture replaces it.
ALTER TABLE riviamigo.vehicle_ingestion_diagnostics
    ADD COLUMN capture_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN started_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN stopped_at timestamptz,
    ADD COLUMN stop_reason text,
    ADD COLUMN dropped_events bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT vehicle_ingestion_diagnostics_stop_reason_check
        CHECK (stop_reason IS NULL OR stop_reason IN ('user', 'expired'));

UPDATE riviamigo.vehicle_ingestion_diagnostics
SET started_at = updated_at;

-- Capture events hold sanitized ingestion facts only: no coordinates,
-- credentials, VINs, or names. They are purged 24 hours after a capture stops.
CREATE TABLE riviamigo.vehicle_ingestion_capture_events (
    id bigserial PRIMARY KEY,
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    capture_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL,
    kind text NOT NULL,
    fields jsonb NOT NULL
);

CREATE INDEX vehicle_ingestion_capture_events_capture_idx
    ON riviamigo.vehicle_ingestion_capture_events (capture_id, id);
CREATE INDEX vehicle_ingestion_capture_events_vehicle_idx
    ON riviamigo.vehicle_ingestion_capture_events (vehicle_id);
