-- Move dashboard configs to the current v2 component model.
-- This is a one-time backfill, not a runtime compatibility layer.

WITH mapped AS (
    SELECT
        id,
        jsonb_set(
            config::jsonb,
            '{widgets}',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN widget ? 'componentType' THEN widget
                            ELSE (widget - 'widgetId') || jsonb_build_object(
                                'componentType',
                                CASE
                                    WHEN widget->>'widgetId' = 'chart.catalog' THEN 'chart'
                                    WHEN widget->>'widgetId' = 'metric.stat' THEN 'sensor'
                                    WHEN widget->>'widgetId' LIKE 'stat.%' THEN 'sensor'
                                    ELSE 'custom'
                                END,
                                'definitionId',
                                CASE widget->>'widgetId'
                                    WHEN 'custom.overview_vehicle' THEN 'overview.vehicle'
                                    WHEN 'chart.catalog' THEN 'catalog'
                                    WHEN 'map.trips' THEN 'trips.map'
                                    WHEN 'table.trips' THEN 'trips.table'
                                    WHEN 'table.charge_sessions' THEN 'charging.sessions.table'
                                    WHEN 'stat.current_soc' THEN 'battery_level'
                                    WHEN 'stat.est_range' THEN 'range_miles'
                                    WHEN 'stat.phantom_drain_avg' THEN 'battery_level'
                                    WHEN 'stat.capacity_health' THEN 'range_miles'
                                    WHEN 'stat.total_energy' THEN 'energy_charged'
                                    WHEN 'stat.charging_sessions' THEN 'charging_sessions'
                                    WHEN 'stat.total_cost' THEN 'total_cost'
                                    WHEN 'stat.avg_session' THEN 'avg_session_energy'
                                    WHEN 'stat.avg_efficiency_period' THEN 'avg_efficiency'
                                    WHEN 'stat.best_efficiency' THEN 'avg_efficiency'
                                    WHEN 'stat.worst_efficiency' THEN 'avg_efficiency'
                                    WHEN 'stat.efficiency_miles' THEN 'trip_miles'
                                    WHEN 'metric.stat' THEN COALESCE(widget #>> '{options,metric}', 'total_miles')
                                    ELSE replace(widget->>'widgetId', '.', '-')
                                END
                            )
                        END
                    )
                    FROM jsonb_array_elements(COALESCE(config::jsonb->'widgets', '[]'::jsonb)) AS widget
                ),
                '[]'::jsonb
            ),
            true
        ) AS next_config
    FROM dashboards
    WHERE config::jsonb->>'schemaVersion' IS DISTINCT FROM '2'
)
UPDATE dashboards
SET
    config = jsonb_set(next_config, '{schemaVersion}', '2'::jsonb, true),
    updated_at = NOW()
FROM mapped
WHERE dashboards.id = mapped.id;
