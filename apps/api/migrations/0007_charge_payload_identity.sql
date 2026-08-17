-- Give charge-history payloads a durable semantic identity without deleting
-- any existing audit rows. The identity registry lets new writers serialize
-- concurrent inserts even when an older installation already contains exact
-- duplicates that cannot be made unique in-place.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Upstream live-session wrappers include retrieval metadata such as updatedAt.
-- Strip only those known volatile keys before hashing; charging values and
-- completed-session timestamps remain part of the semantic payload.
CREATE OR REPLACE FUNCTION riviamigo.semantic_charge_payload(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    key text;
    child jsonb;
    result jsonb;
BEGIN
    IF jsonb_typeof(input) = 'object' THEN
        result := '{}'::jsonb;
        FOR key, child IN SELECT object_key, object_value FROM jsonb_each(input) AS entries(object_key, object_value)
        LOOP
            IF key NOT IN ('updatedAt', 'retrievedAt', 'capturedAt', 'observedAt', 'fetchedAt', 'lastUpdatedAt') THEN
                result := result || jsonb_build_object(key, riviamigo.semantic_charge_payload(child));
            END IF;
        END LOOP;
        RETURN result;
    ELSIF jsonb_typeof(input) = 'array' THEN
        result := '[]'::jsonb;
        FOR child IN SELECT value FROM jsonb_array_elements(input) AS values(value)
        LOOP
            result := result || jsonb_build_array(riviamigo.semantic_charge_payload(child));
        END LOOP;
        RETURN result;
    END IF;

    RETURN input;
END;
$$;

ALTER TABLE riviamigo.rivian_charge_payloads
    ADD COLUMN IF NOT EXISTS payload_fingerprint bytea;

-- New writes populate payload_fingerprint immediately. Existing rows are
-- completed by the charge_payload_identity_backfill worker after the API is
-- healthy, in bounded restart-safe transactions.
CREATE TABLE IF NOT EXISTS riviamigo.rivian_charge_payload_identities (
    identity_key bytea PRIMARY KEY,
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    operation text NOT NULL,
    payload_fingerprint bytea NOT NULL,
    canonical_payload_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rivian_charge_payload_identities_payload_idx
    ON riviamigo.rivian_charge_payload_identities
        (vehicle_id, operation, payload_fingerprint);

CREATE TABLE IF NOT EXISTS riviamigo.charge_payload_identity_backfill_status (
    job_key text PRIMARY KEY,
    status text NOT NULL,
    rows_scanned bigint NOT NULL DEFAULT 0,
    fingerprints_filled bigint NOT NULL DEFAULT 0,
    identities_inserted bigint NOT NULL DEFAULT 0,
    last_error text,
    started_at timestamptz,
    completed_at timestamptz,
    heartbeat_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO riviamigo.charge_payload_identity_backfill_status (job_key, status)
VALUES ('charge_payload_identity', 'pending')
ON CONFLICT (job_key) DO NOTHING;
