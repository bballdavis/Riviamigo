-- no-transaction
-- Migration 0040: make rivian_charge_payloads hypertable-compatible and
-- enforce 90-day retention deterministically.

-- TimescaleDB hypertables require any unique index to include the partitioning
-- column. The original primary key on (id) blocks conversion.
ALTER TABLE riviamigo.rivian_charge_payloads
  DROP CONSTRAINT IF EXISTS rivian_charge_payloads_pkey;

-- Preserve strong id uniqueness semantics while satisfying hypertable rules.
CREATE UNIQUE INDEX IF NOT EXISTS rivian_charge_payloads_id_captured_uidx
  ON riviamigo.rivian_charge_payloads (id, captured_at);

SELECT create_hypertable(
  'riviamigo.rivian_charge_payloads',
  'captured_at',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

SELECT add_retention_policy(
  'riviamigo.rivian_charge_payloads',
  INTERVAL '90 days',
  if_not_exists => TRUE
);