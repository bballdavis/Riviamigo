CREATE TABLE IF NOT EXISTS riviamigo.account_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invited_by UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_user_id UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_invitations_active_email_idx
  ON riviamigo.account_invitations (lower(invitee_email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS account_invitations_created_idx
  ON riviamigo.account_invitations (created_at DESC);
