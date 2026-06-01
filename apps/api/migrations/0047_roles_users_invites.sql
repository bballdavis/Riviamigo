ALTER TABLE riviamigo.users
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE riviamigo.users
SET role = 'admin'
WHERE role IS NULL OR btrim(role) = '';

UPDATE riviamigo.users
SET role = 'user'
WHERE role NOT IN ('super_user', 'admin', 'user');

WITH earliest_admin AS (
  SELECT id
  FROM riviamigo.users
  WHERE role = 'admin'
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE riviamigo.users u
SET role = 'super_user'
FROM earliest_admin ea
WHERE u.id = ea.id
  AND NOT EXISTS (
    SELECT 1 FROM riviamigo.users su WHERE su.role = 'super_user'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'riviamigo.users'::regclass
  ) THEN
    ALTER TABLE riviamigo.users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('super_user', 'admin', 'user'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS riviamigo.vehicle_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_invites_role_check CHECK (role IN ('owner', 'manager', 'viewer'))
);

CREATE INDEX IF NOT EXISTS vehicle_invites_vehicle_idx
  ON riviamigo.vehicle_invites(vehicle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicle_invites_email_idx
  ON riviamigo.vehicle_invites(invitee_email, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicle_invites_active_idx
  ON riviamigo.vehicle_invites(invitee_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
SELECT v.id,
       v.user_id,
       'owner',
       COALESCE(u.default_vehicle_id = v.id, FALSE)
FROM riviamigo.vehicles v
JOIN riviamigo.users u ON u.id = v.user_id
ON CONFLICT (vehicle_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    updated_at = now();

INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id, display_name)
SELECT v.id,
       v.user_id,
       v.name
FROM riviamigo.vehicles v
ON CONFLICT (vehicle_id, user_id) DO NOTHING;

INSERT INTO riviamigo.vehicle_memberships (vehicle_id, user_id, role, is_default)
SELECT v.id,
       u.id,
       'owner',
       COALESCE(u.default_vehicle_id = v.id, FALSE)
FROM riviamigo.vehicles v
JOIN riviamigo.users u ON lower(u.email) = 'philip@davisho.me'
ON CONFLICT (vehicle_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    updated_at = now();

INSERT INTO riviamigo.vehicle_user_settings (vehicle_id, user_id, display_name)
SELECT v.id,
       u.id,
       v.name
FROM riviamigo.vehicles v
JOIN riviamigo.users u ON lower(u.email) = 'philip@davisho.me'
ON CONFLICT (vehicle_id, user_id) DO NOTHING;

WITH philip AS (
  SELECT id FROM riviamigo.users WHERE lower(email) = 'philip@davisho.me' LIMIT 1
),
philip_counts AS (
  SELECT p.id AS user_id, COUNT(vm.vehicle_id) AS vehicle_count
  FROM philip p
  LEFT JOIN riviamigo.vehicle_memberships vm ON vm.user_id = p.id
  GROUP BY p.id
),
single_vehicle AS (
  SELECT vm.user_id, vm.vehicle_id
  FROM riviamigo.vehicle_memberships vm
  JOIN philip_counts pc ON pc.user_id = vm.user_id
  WHERE pc.vehicle_count = 1
)
UPDATE riviamigo.vehicle_memberships vm
SET is_default = CASE WHEN vm.vehicle_id = sv.vehicle_id THEN TRUE ELSE FALSE END,
    updated_at = now()
FROM single_vehicle sv
WHERE vm.user_id = sv.user_id;

WITH philip_default AS (
  SELECT vm.user_id, vm.vehicle_id
  FROM riviamigo.vehicle_memberships vm
  JOIN riviamigo.users u ON u.id = vm.user_id
  WHERE lower(u.email) = 'philip@davisho.me' AND vm.is_default = TRUE
  ORDER BY vm.updated_at DESC
  LIMIT 1
)
UPDATE riviamigo.users u
SET default_vehicle_id = pd.vehicle_id
FROM philip_default pd
WHERE u.id = pd.user_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM riviamigo.users WHERE role = 'super_user') THEN
    RAISE EXCEPTION 'at least one super_user is required after migration 0047';
  END IF;
END $$;
