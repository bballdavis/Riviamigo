-- Account-scoped chart favorites must survive browser changes and dashboard upgrades.
ALTER TABLE riviamigo.user_preferences
    ADD COLUMN dashboard_chart_favorites jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE riviamigo.user_preferences
    ADD CONSTRAINT user_preferences_dashboard_chart_favorites_object_check
    CHECK (jsonb_typeof(dashboard_chart_favorites) = 'object');
