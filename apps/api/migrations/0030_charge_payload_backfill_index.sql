-- The backfill worker keeps this index after finishing historical rows.
-- Include it in the migration chain so fresh and restored candidates have
-- the same schema contract as installations that have run the worker.
CREATE INDEX IF NOT EXISTS rivian_charge_payloads_identity_pending_idx
    ON riviamigo.rivian_charge_payloads (captured_at, id)
    WHERE payload_fingerprint IS NULL;
