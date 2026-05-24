ALTER TABLE riviamigo.vehicle_runtime_state
  ADD COLUMN IF NOT EXISTS auth_state TEXT,
  ADD COLUMN IF NOT EXISTS auth_reason_code TEXT;

UPDATE riviamigo.vehicle_runtime_state
SET auth_state = CASE
        WHEN worker_health = 'needs_reauth' THEN 'needs_reauth'
        WHEN worker_health IS NOT NULL THEN 'authorized'
        ELSE auth_state
    END,
    auth_reason_code = CASE
        WHEN worker_health = 'needs_reauth' AND auth_reason_code IS NULL THEN 'legacy_worker_health'
        ELSE auth_reason_code
    END
WHERE auth_state IS NULL;