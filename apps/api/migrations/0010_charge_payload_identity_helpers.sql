-- Keep charge-payload canonicalization and identity-key construction identical
-- across ingestion, historical backfill, fixtures, and compaction.
CREATE OR REPLACE FUNCTION riviamigo.charge_payload_fingerprint(input jsonb)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT digest(convert_to(riviamigo.semantic_charge_payload(input)::text, 'UTF8'), 'sha256')
$$;

CREATE OR REPLACE FUNCTION riviamigo.charge_payload_identity_key(
    vehicle_id uuid,
    operation text,
    rivian_transaction_id text,
    rivian_vehicle_id text,
    payload_fingerprint bytea
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT digest(
        convert_to(
            concat_ws(
                E'\x1f',
                vehicle_id::text,
                operation,
                coalesce(rivian_transaction_id, ''),
                coalesce(rivian_vehicle_id, ''),
                encode(payload_fingerprint, 'hex')
            ),
            'UTF8'
        ),
        'sha256'
    )
$$;
