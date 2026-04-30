-- Enable cube + earthdistance for point-in-circle geofence queries.
-- These extensions must be created before any ll_to_earth() / earth_distance()
-- calls or GIST indexes that depend on them.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ── addresses ────────────────────────────────────────────────────────────────
-- Lazy OSM Nominatim cache. Rows are only written when a user explicitly
-- opts in to geocoding; never auto-populated.
CREATE TABLE IF NOT EXISTS riviamigo.addresses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT        NOT NULL,
  osm_id       BIGINT      UNIQUE,
  latitude     FLOAT8      NOT NULL,
  longitude    FLOAT8      NOT NULL,
  road         TEXT,
  city         TEXT,
  state        TEXT,
  postcode     TEXT,
  country      TEXT,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addresses_ll_idx
  ON riviamigo.addresses USING gist (ll_to_earth(latitude, longitude));

-- ── geofences ─────────────────────────────────────────────────────────────────
-- Per-user named circles used for location tagging, cost-profile lookup,
-- home/work classification, and "visited" grouping.
-- cost_profile_id FK is added in 0008 once that table exists.
CREATE TABLE IF NOT EXISTS riviamigo.geofences (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES riviamigo.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  latitude     FLOAT8      NOT NULL,
  longitude    FLOAT8      NOT NULL,
  radius_m     FLOAT8      NOT NULL DEFAULT 50,
  address_id   UUID        REFERENCES riviamigo.addresses(id),
  is_home      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_work      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofences_user_idx
  ON riviamigo.geofences (user_id);

CREATE INDEX IF NOT EXISTS geofences_ll_idx
  ON riviamigo.geofences USING gist (ll_to_earth(latitude, longitude));
