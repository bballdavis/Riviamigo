-- Remembers whether each user keeps the Vehicle Overview's location map
-- expanded. Collapsed (the normal three-column layout) by default.

ALTER TABLE riviamigo.user_preferences
    ADD COLUMN overview_map_expanded boolean NOT NULL DEFAULT false;
