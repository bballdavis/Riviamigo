-- Manual maintenance jobs a vehicle manager can start from Settings > Jobs,
-- such as recalculating every charging session's cost after a cost-model fix.
-- Each press records one run so the page can show the latest status, when it
-- ran, and what it touched.
--
-- `job_kind` names an entry in the API's job registry
-- (`services/maintenance_jobs.rs`); unknown kinds are rejected before insert.
-- The partial unique index allows at most one running run per vehicle and kind,
-- so a second press while one is running is refused instead of doubling work.
-- A run interrupted by a restart stays `running` until the API marks it
-- `error` once it is older than the stale window.
CREATE TABLE IF NOT EXISTS riviamigo.maintenance_job_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES riviamigo.vehicles(id) ON DELETE CASCADE,
    job_kind text NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'done', 'error')),
    requested_by uuid REFERENCES riviamigo.users(id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    processed_count integer,
    changed_count integer,
    failed_count integer,
    error text
);

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_job_runs_one_running
    ON riviamigo.maintenance_job_runs (vehicle_id, job_kind)
    WHERE status = 'running';

CREATE INDEX IF NOT EXISTS maintenance_job_runs_latest
    ON riviamigo.maintenance_job_runs (vehicle_id, job_kind, started_at DESC);
