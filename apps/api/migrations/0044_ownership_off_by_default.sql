-- The Ownership dashboard is in preview, so it is off for new users until
-- they turn it on in Settings, under Ownership. Existing preferences keep
-- whatever they hold.

ALTER TABLE riviamigo.user_preferences
    ALTER COLUMN ownership_enabled SET DEFAULT false;
