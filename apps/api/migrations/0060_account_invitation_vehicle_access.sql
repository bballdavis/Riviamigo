ALTER TABLE riviamigo.account_invitations
  ADD COLUMN IF NOT EXISTS vehicle_id UUID
    REFERENCES riviamigo.vehicles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS account_invitations_vehicle_idx
  ON riviamigo.account_invitations (vehicle_id)
  WHERE vehicle_id IS NOT NULL;
