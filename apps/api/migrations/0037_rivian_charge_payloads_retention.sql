-- Add a 90-day retention policy for raw Rivian charge event payloads.
-- Requires TimescaleDB (the table was created as a hypertable in an earlier migration).
SELECT add_retention_policy('riviamigo.rivian_charge_payloads', INTERVAL '90 days');
