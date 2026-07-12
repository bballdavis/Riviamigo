-- Convert persisted legacy Trips stat chips to reusable sensor widgets.
-- Preserve widget IDs, titles, positions, and visual options while moving the
-- component type and metric definition to the shared sensor-chip registry.

WITH rewritten AS (
    SELECT
        dashboards.id,
        BOOL_OR(mapped.definition_id IS NOT NULL) AS has_legacy_trip_stat,
        jsonb_agg(
            CASE
                WHEN mapped.definition_id IS NULL THEN entry.widget
                ELSE entry.widget || jsonb_build_object(
                    'componentType', 'sensor',
                    'definitionId', mapped.definition_id,
                    'options',
                        (COALESCE(entry.widget->'options', '{}'::jsonb) - 'stat' - 'metric')
                        || jsonb_build_object(
                            'metric', mapped.definition_id,
                            'tripSelectionAware', true
                        )
                        || CASE
                            WHEN mapped.definition_id IN ('trip_miles', 'total_trips')
                                THEN jsonb_build_object('valueMode', 'sum')
                            WHEN mapped.definition_id = 'avg_trip_duration'
                                THEN jsonb_build_object('valueMode', 'avg')
                            ELSE '{}'::jsonb
                        END
                )
            END
            ORDER BY entry.ordinal
        ) AS widgets
    FROM dashboards
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(dashboards.config::jsonb->'widgets', '[]'::jsonb)
    ) WITH ORDINALITY AS entry(widget, ordinal)
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN entry.widget->>'componentType' = 'custom'
                AND entry.widget->>'definitionId' = 'trips.stat'
                AND entry.widget #>> '{options,metric}' IN (
                    'trip_miles', 'total_trips', 'avg_efficiency', 'avg_trip_duration'
                ) THEN entry.widget #>> '{options,metric}'
            WHEN entry.widget->>'componentType' = 'custom'
                AND entry.widget->>'definitionId' = 'trips.stat'
                THEN CASE entry.widget #>> '{options,stat}'
                    WHEN 'miles' THEN 'trip_miles'
                    WHEN 'count' THEN 'total_trips'
                    WHEN 'efficiency' THEN 'avg_efficiency'
                    WHEN 'duration' THEN 'avg_trip_duration'
                    ELSE NULL
                END
            ELSE NULL
        END AS definition_id
    ) AS mapped
    GROUP BY dashboards.id
)
UPDATE dashboards
SET
    config = jsonb_set(dashboards.config::jsonb, '{widgets}', rewritten.widgets, true),
    updated_at = NOW()
FROM rewritten
WHERE dashboards.id = rewritten.id
  AND rewritten.has_legacy_trip_stat;
