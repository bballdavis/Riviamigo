-- The Ownership dashboard is in preview, so it is off until each user turns
-- it on in Settings, under Ownership.
--
-- 0037 added the switch with every existing row set to on, before any user
-- could have chosen. No release shipped between the two migrations, so no
-- stored value is a user's own choice yet; reset them all to off.

ALTER TABLE riviamigo.user_preferences
    ALTER COLUMN ownership_enabled SET DEFAULT false;

UPDATE riviamigo.user_preferences SET ownership_enabled = false WHERE ownership_enabled;
