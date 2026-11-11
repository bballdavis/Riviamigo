-- Lets each user hide the Ownership dashboard. It is shown unless the user
-- turns it off in Settings, under Ownership.

ALTER TABLE riviamigo.user_preferences
    ADD COLUMN ownership_enabled boolean NOT NULL DEFAULT true;
