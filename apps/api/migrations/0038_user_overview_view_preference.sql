-- Remembers which view each user last chose for the Vehicle Overview: the
-- vehicle cluster (the default) or the current-location map.

ALTER TABLE riviamigo.user_preferences
    ADD COLUMN overview_view text NOT NULL DEFAULT 'cluster'
        CONSTRAINT user_preferences_overview_view_check CHECK (overview_view IN ('cluster', 'map'));
