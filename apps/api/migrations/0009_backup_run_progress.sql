-- Make long-running backup execution observable without keeping the HTTP
-- request open. Existing rows retain their terminal status and are given a
-- neutral phase until the next API startup reconciliation or new run.
ALTER TABLE riviamigo.backup_runs
    ADD COLUMN phase text NOT NULL DEFAULT 'queued';

ALTER TABLE riviamigo.backup_runs
    ADD COLUMN progress_percent smallint NOT NULL DEFAULT 0;

ALTER TABLE riviamigo.backup_runs
    ADD CONSTRAINT backup_runs_progress_percent_check
    CHECK (progress_percent BETWEEN 0 AND 100);

UPDATE riviamigo.backup_runs
SET phase = CASE status
        WHEN 'succeeded' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        WHEN 'canceled' THEN 'failed'
        ELSE phase
    END,
    progress_percent = CASE status
        WHEN 'succeeded' THEN 100
        WHEN 'failed' THEN LEAST(progress_percent, 99)
        WHEN 'canceled' THEN LEAST(progress_percent, 99)
        ELSE progress_percent
    END
WHERE status IN ('succeeded', 'failed', 'canceled');
