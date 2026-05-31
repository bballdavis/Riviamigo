-- Collapse consecutive duplicate software-version rows and enforce one open row per vehicle.
WITH ordered AS (
  SELECT
    id,
    vehicle_id,
    version,
    installed_at,
    observed_until,
    LAG(id) OVER (PARTITION BY vehicle_id ORDER BY installed_at, id) AS prev_id,
    LAG(version) OVER (PARTITION BY vehicle_id ORDER BY installed_at, id) AS prev_version
  FROM riviamigo.software_versions
),
dups AS (
  SELECT id, prev_id, observed_until
  FROM ordered
  WHERE prev_id IS NOT NULL
    AND prev_version = version
)
UPDATE riviamigo.software_versions prev
SET observed_until = CASE
  WHEN prev.observed_until IS NULL OR dups.observed_until IS NULL THEN NULL
  WHEN prev.observed_until >= dups.observed_until THEN prev.observed_until
  ELSE dups.observed_until
END
FROM dups
WHERE prev.id = dups.prev_id;

WITH ordered AS (
  SELECT
    id,
    vehicle_id,
    version,
    LAG(version) OVER (PARTITION BY vehicle_id ORDER BY installed_at, id) AS prev_version
  FROM riviamigo.software_versions
)
DELETE FROM riviamigo.software_versions sv
USING ordered
WHERE sv.id = ordered.id
  AND ordered.prev_version = ordered.version;

-- Ensure at most one open row per vehicle before adding the partial unique index.
-- Keep the newest open row and close any older open rows.
WITH open_rows AS (
  SELECT
    id,
    installed_at,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id
      ORDER BY installed_at DESC, id DESC
    ) AS rn
  FROM riviamigo.software_versions
  WHERE observed_until IS NULL
)
UPDATE riviamigo.software_versions sv
SET observed_until = open_rows.installed_at
FROM open_rows
WHERE sv.id = open_rows.id
  AND open_rows.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sv_open_one_per_vehicle_idx
  ON riviamigo.software_versions (vehicle_id)
  WHERE observed_until IS NULL;
