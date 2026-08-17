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

UPDATE riviamigo.rivian_charge_payloads
SET payload_fingerprint = digest(
    convert_to(riviamigo.semantic_charge_payload(payload)::text, 'UTF8'),
    'sha256'
);

ALTER TABLE riviamigo.rivian_charge_payloads
    ALTER COLUMN payload_fingerprint SET NOT NULL;

CREATE INDEX IF NOT EXISTS rivian_charge_payloads_semantic_identity_idx
    ON riviamigo.rivian_charge_payloads
        (vehicle_id, operation, payload_fingerprint, captured_at DESC);

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

-- Preserve all payload rows while choosing the oldest linked row as the
-- canonical identity for future replays. The identity key includes the
-- upstream identifiers and the canonical JSONB representation, so volatile
-- retrieval timestamps outside the stored semantic payload cannot create a
-- second identity.
INSERT INTO riviamigo.rivian_charge_payload_identities (
    identity_key,
    vehicle_id,
    operation,
    payload_fingerprint,
    canonical_payload_id
)
SELECT DISTINCT ON (
    payload.vehicle_id,
    payload.operation,
    payload.payload_fingerprint,
    payload.rivian_transaction_id,
    payload.rivian_vehicle_id
)
    digest(
        convert_to(
            concat_ws(
                E'\x1f',
                payload.vehicle_id::text,
                payload.operation,
                coalesce(payload.rivian_transaction_id, ''),
                coalesce(payload.rivian_vehicle_id, ''),
                encode(payload.payload_fingerprint, 'hex')
            ),
            'UTF8'
        ),
        'sha256'
    ),
    payload.vehicle_id,
    payload.operation,
    payload.payload_fingerprint,
    payload.id
FROM riviamigo.rivian_charge_payloads payload
ORDER BY
    payload.vehicle_id,
    payload.operation,
    payload.payload_fingerprint,
    payload.rivian_transaction_id,
    payload.rivian_vehicle_id,
    (payload.charge_session_id IS NOT NULL) DESC,
    payload.captured_at,
    payload.id
ON CONFLICT (identity_key) DO NOTHING;
