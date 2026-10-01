-- Ingestion used to record a frame that carried no power state (a door,
-- window, or tire update) as an Unknown state period, splitting the timeline
-- into seconds-long periods. Ingestion no longer does this; repair the
-- existing history once.
--
-- 1. An Unknown period that follows another period is spurious unless the
--    vehicle reported it: a telemetry row with power_state 'unknown'
--    (standby) at its start. Spurious periods are dropped and the period they
--    followed covers their time. An Unknown period after a real gap (for
--    example after downtime) is kept; it is not split time.
-- 2. Neighbouring periods with the same state that now follow each other are
--    merged.
--
-- "Follows" allows up to 10 minutes between periods, the same tolerance
-- history replay uses when it builds periods from telemetry rows. Malformed
-- periods (ending before they start, or overlapping another period) and
-- their direct neighbours are left exactly as they are.

CREATE TEMP TABLE state_period_repair AS
WITH checked AS (
    SELECT
        p.*,
        p.ended_at < p.started_at OR EXISTS (
            SELECT 1
            FROM riviamigo.vehicle_state_periods other
            WHERE other.vehicle_id = p.vehicle_id
              AND other.id <> p.id
              AND other.started_at < coalesce(p.ended_at, 'infinity')
              AND p.started_at < coalesce(other.ended_at, 'infinity')
        ) AS malformed
    FROM riviamigo.vehicle_state_periods p
),
ordered AS (
    SELECT
        c.*,
        lag(c.ended_at) OVER w AS previous_ended_at,
        lag(c.malformed) OVER w AS previous_malformed,
        coalesce(lead(c.malformed) OVER w, false) AS next_malformed
    FROM checked c
    WINDOW w AS (PARTITION BY c.vehicle_id ORDER BY c.started_at, c.id)
)
SELECT
    o.id,
    o.vehicle_id,
    o.state,
    o.started_at,
    o.ended_at,
    o.malformed OR o.previous_malformed IS TRUE OR o.next_malformed AS frozen,
    o.state = 'unknown'
        AND NOT o.malformed
        AND NOT coalesce(o.previous_malformed, false)
        AND NOT o.next_malformed
        AND o.started_at >= o.previous_ended_at
        AND o.started_at - o.previous_ended_at <= interval '10 minutes'
        AND NOT EXISTS (
            SELECT 1
            FROM timeseries.telemetry t
            WHERE t.vehicle_id = o.vehicle_id
              AND t.ts = o.started_at
              AND t.power_state = 'unknown'
        ) AS spurious
FROM ordered o;

-- Each group is one kept period followed by the spurious periods that
-- continue it.
CREATE TEMP TABLE state_period_groups AS
SELECT
    *,
    sum(CASE WHEN NOT spurious THEN 1 ELSE 0 END)
        OVER (PARTITION BY vehicle_id ORDER BY started_at, id) AS grp
FROM state_period_repair;

CREATE TEMP TABLE state_period_absorbed AS
SELECT
    vehicle_id,
    min(id) FILTER (WHERE NOT spurious) AS id,
    min(state) FILTER (WHERE NOT spurious) AS state,
    min(started_at) FILTER (WHERE NOT spurious) AS started_at,
    bool_or(frozen) FILTER (WHERE NOT spurious) AS frozen,
    max(ended_at) FILTER (WHERE NOT spurious) AS own_ended_at,
    CASE WHEN bool_or(ended_at IS NULL) THEN NULL ELSE max(ended_at) END AS ended_at
FROM state_period_groups
GROUP BY vehicle_id, grp
HAVING bool_or(NOT spurious);

-- An extended period stops where the next kept period starts. Overlaps that
-- already existed between kept periods are left as they were.
CREATE TEMP TABLE state_period_kept AS
WITH neighbours AS (
    SELECT
        *,
        lead(started_at) OVER (PARTITION BY vehicle_id ORDER BY started_at, id) AS next_started_at
    FROM state_period_absorbed
)
SELECT
    vehicle_id,
    id,
    state,
    started_at,
    frozen,
    CASE
        WHEN next_started_at IS NOT NULL
         AND (ended_at IS NULL OR ended_at > next_started_at)
        THEN greatest(coalesce(own_ended_at, next_started_at), next_started_at)
        ELSE ended_at
    END AS ended_at
FROM neighbours;

-- Merge touching kept periods that share a state.
CREATE TEMP TABLE state_period_final AS
WITH neighbours AS (
    SELECT
        *,
        lag(state) OVER w AS previous_state,
        lag(ended_at) OVER w AS previous_ended_at,
        coalesce(lag(frozen) OVER w, false) AS previous_frozen
    FROM state_period_kept
    WINDOW w AS (PARTITION BY vehicle_id ORDER BY started_at, id)
),
runs AS (
    SELECT
        *,
        sum(CASE
                WHEN state IS DISTINCT FROM previous_state
                  OR frozen
                  OR previous_frozen
                  OR previous_ended_at IS NULL
                  OR started_at < previous_ended_at
                  OR started_at - previous_ended_at > interval '10 minutes'
                THEN 1 ELSE 0
            END) OVER (PARTITION BY vehicle_id ORDER BY started_at, id) AS run
    FROM neighbours
)
SELECT
    (array_agg(id ORDER BY started_at, id))[1] AS id,
    CASE WHEN bool_or(ended_at IS NULL) THEN NULL ELSE max(ended_at) END AS ended_at
FROM runs
GROUP BY vehicle_id, run;

-- Delete first so the single open period per vehicle stays unique.
DELETE FROM riviamigo.vehicle_state_periods p
WHERE NOT EXISTS (SELECT 1 FROM state_period_final f WHERE f.id = p.id);

UPDATE riviamigo.vehicle_state_periods p
SET ended_at = f.ended_at
FROM state_period_final f
WHERE f.id = p.id
  AND p.ended_at IS DISTINCT FROM f.ended_at;

DROP TABLE state_period_final;
DROP TABLE state_period_kept;
DROP TABLE state_period_absorbed;
DROP TABLE state_period_groups;
DROP TABLE state_period_repair;
