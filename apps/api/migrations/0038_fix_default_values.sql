-- Remove opinionated hard-coded defaults from user_preferences.
-- electricity_rate_per_kwh DEFAULT 0.13 silently applies the US Midwest rate to
-- every new user before they have had a chance to configure their preferences.
-- home_timezone DEFAULT 'America/Chicago' likewise forces a specific timezone on
-- all new users regardless of locale.
-- Both columns are NULLABLE, so dropping the default causes new rows without an
-- explicit value to get NULL instead of a misleading default.
ALTER TABLE riviamigo.user_preferences
    ALTER COLUMN electricity_rate_per_kwh DROP DEFAULT,
    ALTER COLUMN home_timezone            DROP DEFAULT;
