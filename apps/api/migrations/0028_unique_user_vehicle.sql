WITH duplicate_candidates AS (
  SELECT
    v.id,
    row_number() OVER (
      PARTITION BY v.user_id, v.rivian_vehicle_id
      ORDER BY
        (COALESCE(cs.count, 0) + COALESCE(tr.count, 0) + COALESCE(te.count, 0)) DESC,
        v.created_at ASC
    ) AS duplicate_rank,
    COALESCE(cs.count, 0) AS charge_sessions,
    COALESCE(tr.count, 0) AS trips,
    COALESCE(te.count, 0) AS telemetry_samples
  FROM riviamigo.vehicles v
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count
    FROM riviamigo.charge_sessions cs
    WHERE cs.vehicle_id = v.id
  ) cs ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count
    FROM riviamigo.trips tr
    WHERE tr.vehicle_id = v.id
  ) tr ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count
    FROM timeseries.telemetry te
    WHERE te.vehicle_id = v.id
  ) te ON true
)
DELETE FROM riviamigo.vehicles v
USING duplicate_candidates d
WHERE v.id = d.id
  AND d.duplicate_rank > 1
  AND d.charge_sessions = 0
  AND d.trips = 0
  AND d.telemetry_samples = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_user_rivian_vehicle_id
ON riviamigo.vehicles (user_id, rivian_vehicle_id);
