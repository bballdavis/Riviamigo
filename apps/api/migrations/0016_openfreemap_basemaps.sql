ALTER TABLE riviamigo.external_connection_settings
    ADD COLUMN basemap_provider TEXT NOT NULL DEFAULT 'auto',
    ADD CONSTRAINT external_connection_settings_basemap_provider_check
        CHECK (basemap_provider IN ('auto', 'openfreemap', 'carto'));

ALTER TABLE riviamigo.user_preferences
    ADD COLUMN map_style TEXT NOT NULL DEFAULT 'follow-theme',
    ADD CONSTRAINT user_preferences_map_style_check
        CHECK (map_style IN ('follow-theme', 'positron', 'bright', 'liberty', 'dark', 'fiord', '3d'));
