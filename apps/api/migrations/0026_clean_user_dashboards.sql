-- Migration 0026: Scrub retired widgets from user-saved dashboard copies.
--
-- Removes widgets that were added experimentally and never belonged in the
-- shipped defaults:
--   • overview.live.charging  — moved off the overview page
--   • overview.warnings       — moved off the overview page
--   • charging.network_breakdown — backfill-gated; not in the default layout
--
-- Also fixes the total_miles widget in any saved overview dashboard to use
-- daily_delta instead of line so the background graph shows per-day mileage.
--
-- Only touches rows where owner_id IS NOT NULL (user copies; system defaults
-- are managed through the JSON files and reseeded on deploy).

UPDATE dashboards
SET
    config = jsonb_set(
        config,
        '{widgets}',
        COALESCE(
            (
                SELECT jsonb_agg(w)
                FROM   jsonb_array_elements(config->'widgets') AS w
                WHERE  w->>'definitionId' NOT IN (
                    'overview.live.charging',
                    'overview.warnings',
                    'charging.network_breakdown'
                )
            ),
            '[]'::jsonb
        ),
        true
    ),
    updated_at = NOW()
WHERE owner_id IS NOT NULL
  AND slug IN ('dashboard', 'charging')
  AND config->'widgets' @> '[{"definitionId":"overview.live.charging"}]'::jsonb
   OR config->'widgets' @> '[{"definitionId":"overview.warnings"}]'::jsonb
   OR config->'widgets' @> '[{"definitionId":"charging.network_breakdown"}]'::jsonb;


-- Fix total_miles widgets in user-saved overview dashboards: switch chartType
-- from "line" to "daily_delta" and set windowDays to 30.
UPDATE dashboards
SET
    config = jsonb_set(
        config,
        '{widgets}',
        (
            SELECT jsonb_agg(
                CASE
                    WHEN w->>'definitionId' = 'total_miles'
                     AND w->'options'->>'chartType' = 'line'
                    THEN jsonb_set(
                             jsonb_set(w, '{options,chartType}', '"daily_delta"', true),
                             '{options,windowDays}', '30', true
                         )
                    ELSE w
                END
            )
            FROM jsonb_array_elements(config->'widgets') AS w
        ),
        true
    ),
    updated_at = NOW()
WHERE owner_id IS NOT NULL
  AND slug = 'dashboard'
  AND EXISTS (
      SELECT 1
      FROM   jsonb_array_elements(config->'widgets') AS w
      WHERE  w->>'definitionId' = 'total_miles'
        AND  w->'options'->>'chartType' = 'line'
  );
