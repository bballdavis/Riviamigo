-- Charge-payload JSON is retained by TimescaleDB for 90 days. The semantic
-- identity is durable, but its canonical payload is only a cache pointer and
-- must be allowed to expire when Timescale drops an old chunk.
ALTER TABLE riviamigo.rivian_charge_payload_identities
    ALTER COLUMN canonical_payload_id DROP NOT NULL;

COMMENT ON COLUMN riviamigo.rivian_charge_payload_identities.canonical_payload_id IS
    'Optional retained JSON evidence for the durable semantic identity. NULL means Timescale retention expired every matching payload.';

COMMENT ON COLUMN riviamigo.charge_session_external_aliases.latest_payload_id IS
    'Optional cache pointer to retained charge-payload JSON; cleared when Timescale retention drops the payload.';

COMMENT ON COLUMN riviamigo.charge_session_external_aliases.latest_payload_captured_at IS
    'Captured timestamp for latest_payload_id; NULL whenever that retained-evidence cache pointer is cleared.';
