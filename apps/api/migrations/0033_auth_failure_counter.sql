-- Track consecutive auth failures so a single transient 401 (which the CSRF
-- refresh handles cleanly) does not immediately flip auth_state='needs_reauth'.
-- Reset on any successful authenticated operation.
ALTER TABLE riviamigo.vehicle_runtime_state
  ADD COLUMN IF NOT EXISTS consecutive_auth_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_auth_failure_at TIMESTAMPTZ;
