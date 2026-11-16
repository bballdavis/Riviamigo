-- Site-wide jobs on Settings > Jobs.
--
-- 0041 recorded only manual, per-vehicle runs. Jobs that cover the whole
-- installation (recalculating every vehicle's charging costs, the 6-hourly
-- location and weather catch-up, security log cleanup) record their runs in
-- the same table with no vehicle. Automatic passes are recorded too, so the
-- page can show when a background job last ran and what it did.
--
-- `trigger` says whether a person pressed Run or the API ran it on its
-- schedule. `summary` is the human result line the page shows, for example
-- "37 addresses filled · 12 weather lookups queued".
ALTER TABLE riviamigo.maintenance_job_runs
    ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE riviamigo.maintenance_job_runs
    ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual';

ALTER TABLE riviamigo.maintenance_job_runs
    DROP CONSTRAINT IF EXISTS maintenance_job_runs_trigger_check;

ALTER TABLE riviamigo.maintenance_job_runs
    ADD CONSTRAINT maintenance_job_runs_trigger_check
    CHECK (trigger IN ('manual', 'automatic'));

ALTER TABLE riviamigo.maintenance_job_runs
    ADD COLUMN IF NOT EXISTS summary text;

-- The 0041 index treats each NULL vehicle as distinct, so it cannot stop two
-- site-wide runs of the same job. This one does.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_job_runs_one_running_site
    ON riviamigo.maintenance_job_runs (job_kind)
    WHERE vehicle_id IS NULL AND status = 'running';

CREATE INDEX IF NOT EXISTS maintenance_job_runs_site_latest
    ON riviamigo.maintenance_job_runs (job_kind, started_at DESC)
    WHERE vehicle_id IS NULL;
