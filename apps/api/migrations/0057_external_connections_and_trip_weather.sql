CREATE TABLE IF NOT EXISTS riviamigo.external_connection_settings (
  id                         TEXT PRIMARY KEY,
  enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
  mode                       TEXT NOT NULL DEFAULT 'hosted',
  weather_precision          TEXT,
  forecast_url               TEXT,
  archive_url                TEXT,
  base_url                   TEXT,
  light_url_template         TEXT,
  dark_url_template          TEXT,
  attribution                TEXT,
  attribution_url            TEXT,
  request_identifier         TEXT,
  custom_autocomplete        BOOLEAN NOT NULL DEFAULT FALSE,
  allow_private_network      BOOLEAN NOT NULL DEFAULT FALSE,
  api_key_encrypted          BYTEA,
  bearer_token_encrypted     BYTEA,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                 UUID REFERENCES riviamigo.users(id) ON DELETE SET NULL,
  CONSTRAINT external_connection_mode_check
    CHECK (mode IN ('hosted', 'custom', 'disabled')),
  CONSTRAINT external_connection_weather_precision_check
    CHECK (weather_precision IS NULL OR weather_precision IN ('approximate', 'exact'))
);

CREATE TABLE IF NOT EXISTS riviamigo.external_connection_activity (
  connection_id              TEXT PRIMARY KEY REFERENCES riviamigo.external_connection_settings(id) ON DELETE CASCADE,
  last_attempt_at            TIMESTAMPTZ,
  last_success_at            TIMESTAMPTZ,
  last_error                 TEXT,
  usage_date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count              INTEGER NOT NULL DEFAULT 0
);

INSERT INTO riviamigo.external_connection_settings (
  id, enabled, mode, weather_precision, forecast_url, archive_url, base_url,
  light_url_template, dark_url_template, attribution, attribution_url
)
VALUES
  (
    'rivian_account', TRUE, 'hosted', NULL, NULL, NULL,
    'https://rivian.com', NULL, NULL, NULL, 'https://rivian.com/legal/privacy'
  ),
  (
    'open_meteo', TRUE, 'hosted', 'approximate',
    'https://api.open-meteo.com/v1/forecast',
    'https://archive-api.open-meteo.com/v1/archive',
    NULL, NULL, NULL, 'Weather data by Open-Meteo', 'https://open-meteo.com/'
  ),
  (
    'nominatim', TRUE, 'hosted', NULL, NULL, NULL,
    'https://nominatim.openstreetmap.org', NULL, NULL,
    'OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'
  ),
  (
    'basemap', TRUE, 'hosted', NULL, NULL, NULL, NULL,
    'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    'OpenStreetMap contributors and CARTO', 'https://carto.com/attributions'
  ),
  (
    'iconify', TRUE, 'hosted', NULL, NULL, NULL,
    'https://api.iconify.design', NULL, NULL, 'Iconify', 'https://iconify.design/'
  ),
  (
    'rivian_artwork', TRUE, 'hosted', NULL, NULL, NULL,
    'https://rivian.com', NULL, NULL, NULL, 'https://rivian.com/legal/privacy'
  ),
  (
    's3_backup', FALSE, 'custom', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO riviamigo.external_connection_activity (connection_id)
SELECT id FROM riviamigo.external_connection_settings
ON CONFLICT (connection_id) DO NOTHING;

ALTER TABLE riviamigo.trips
  ADD COLUMN IF NOT EXISTS outside_temp_source TEXT;

ALTER TABLE riviamigo.trips
  DROP CONSTRAINT IF EXISTS trips_outside_temp_source_check;

ALTER TABLE riviamigo.trips
  ADD CONSTRAINT trips_outside_temp_source_check
  CHECK (outside_temp_source IS NULL OR outside_temp_source IN ('vehicle', 'open_meteo', 'mixed'));

CREATE TABLE IF NOT EXISTS riviamigo.trip_weather_samples (
  trip_id                     UUID NOT NULL REFERENCES riviamigo.trips(id) ON DELETE CASCADE,
  sampled_at                  TIMESTAMPTZ NOT NULL,
  elapsed_seconds             INTEGER NOT NULL,
  provider_latitude           DOUBLE PRECISION NOT NULL,
  provider_longitude          DOUBLE PRECISION NOT NULL,
  temperature_c               DOUBLE PRECISION NOT NULL,
  source                      TEXT NOT NULL DEFAULT 'open_meteo',
  fetched_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, sampled_at),
  CONSTRAINT trip_weather_samples_source_check CHECK (source IN ('open_meteo'))
);

CREATE INDEX IF NOT EXISTS trip_weather_samples_trip_elapsed_idx
  ON riviamigo.trip_weather_samples (trip_id, elapsed_seconds);

CREATE TABLE IF NOT EXISTS riviamigo.weather_enrichment_jobs (
  trip_id                     UUID PRIMARY KEY REFERENCES riviamigo.trips(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL DEFAULT 'pending',
  attempts                    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                TIMESTAMPTZ,
  CONSTRAINT weather_enrichment_jobs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'unavailable', 'failed'))
);

CREATE INDEX IF NOT EXISTS weather_enrichment_jobs_ready_idx
  ON riviamigo.weather_enrichment_jobs (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

INSERT INTO riviamigo.weather_enrichment_jobs (trip_id)
SELECT t.id
FROM riviamigo.trips t
WHERE t.started_at IS NOT NULL
  AND t.ended_at IS NOT NULL
ON CONFLICT (trip_id) DO NOTHING;
