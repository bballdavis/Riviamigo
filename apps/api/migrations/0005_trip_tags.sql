-- Shared, vehicle-scoped labels for trip planning and efficiency analysis.
-- These deliberately do not use trip_user_annotations: tags are visible to
-- every vehicle member, while annotations are personal enrichment state.

CREATE TABLE riviamigo.trip_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    name text NOT NULL,
    normalized_name text NOT NULL,
    color_token text NOT NULL DEFAULT 'accent',
    created_by uuid NOT NULL REFERENCES riviamigo.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT trip_tags_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT trip_tags_name_length CHECK (char_length(name) <= 64),
    CONSTRAINT trip_tags_normalized_name_not_blank CHECK (length(btrim(normalized_name)) > 0),
    CONSTRAINT trip_tags_color_token_check
        CHECK (color_token IN ('accent', 'neutral', 'info', 'success', 'warning', 'danger')),
    CONSTRAINT trip_tags_vehicle_normalized_name_key UNIQUE (vehicle_id, normalized_name)
);

CREATE INDEX trip_tags_vehicle_created_at_idx
    ON riviamigo.trip_tags (vehicle_id, created_at, id);

CREATE TABLE riviamigo.trip_tag_assignments (
    trip_id uuid NOT NULL REFERENCES riviamigo.trips(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES riviamigo.trip_tags(id) ON DELETE CASCADE,
    assigned_by uuid NOT NULL REFERENCES riviamigo.users(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, tag_id)
);

CREATE INDEX trip_tag_assignments_tag_trip_idx
    ON riviamigo.trip_tag_assignments (tag_id, trip_id);
