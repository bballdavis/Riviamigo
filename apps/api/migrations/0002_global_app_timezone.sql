INSERT INTO riviamigo.system_config (key, value)
SELECT 'app_timezone', COALESCE(
    (SELECT timezone FROM riviamigo.backup_settings WHERE id = TRUE),
    'UTC'
)
WHERE NOT EXISTS (
    SELECT 1 FROM riviamigo.system_config WHERE key = 'app_timezone'
);
