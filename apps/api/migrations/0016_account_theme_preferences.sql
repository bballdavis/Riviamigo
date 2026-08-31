ALTER TABLE riviamigo.user_preferences
    ADD COLUMN theme_mode text NOT NULL DEFAULT 'dark',
    ADD COLUMN theme_palette text NOT NULL DEFAULT 'classic';

ALTER TABLE riviamigo.user_preferences
    ADD CONSTRAINT user_preferences_theme_mode_check
        CHECK (theme_mode = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])),
    ADD CONSTRAINT user_preferences_theme_palette_check
        CHECK (theme_palette = ANY (ARRAY['classic'::text, 'rad'::text]));
