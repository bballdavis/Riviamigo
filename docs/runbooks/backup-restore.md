# Backup and restore runbook

This runbook covers recovery-package validation and clean-install restore. The user-facing workflow is documented in [Backup and restore](../guides/backup-and-restore.md).

## Validate a package before an incident

Run the restore command against an isolated Compose project and a disposable env file:

```bash
node scripts/restore-backup.mjs \
  --package ./backup.rma.tar.gz \
  --env-file ./restore.env \
  --project riviamigo-backup-drill
```

Confirm that the restored instance contains the expected users, vehicles, dashboards, historical telemetry, trips, charging history, and vehicle artwork. Confirm that the Rivian account is disconnected and can be reconnected from Settings.

For repeatable regression of a private historical package, use the gitignored restore lab:

```powershell
pnpm verify:restore-compatibility -- `
  --package C:\path\to\backup.rma.tar.gz `
  --source-build
```

The lab rechecks the package SHA-256, creates disposable Compose storage and credentials, verifies the API and restore supervisor, records a data-free report under `tools/restore-lab/local/reports/`, and removes the stack unless `--keep` is supplied. Never commit packages or lab credentials.

## Incident restore

1. Preserve the recovery package and record its SHA-256 before using it.
2. Prepare the target host with the same or newer Riviamigo release and a valid Compose env file.
3. Leave an existing application running while the command builds and validates its isolated candidate; the wrapper stops the app only after the candidate is ready for the atomic swap.
4. Run `scripts/restore-backup.mjs` without `--force` first. It must refuse a target that already contains users.
5. Use `--force` only after confirming the target is intentionally being replaced.
6. Wait for the health and setup-state checks and complete provider re-authentication.
7. Download a fresh recovery package from the restored installation after verifying it.

## In-app restore diagnostics

The unified production image runs nginx, the API, and a local-only restore supervisor. A restore job is journaled under `/backups/.restore-jobs`; nginx proxies its capability-token status endpoint even while the API process is intentionally stopped. Before handoff, that journal also snapshots the backup runs, artifact catalog, and restore request history. The restarted API merges the snapshot back after the supervisor marks the job complete. The supervisor never receives Docker access and does not restart PostgreSQL or Redis.

For an in-app restore:

1. Confirm the package finishes import validation and preflight records the expected package checksum and source/target profiles.
2. Confirm the isolated candidate reaches validation before the safety package is written and before the API stops.
3. Follow the phase shown in the UI or inspect `.restore-jobs/<job-id>.json` for the plan, candidate validation report, retryability, and rollback state.
4. If verification fails, confirm rollback state becomes `succeeded` and the previous API becomes healthy. Preserve the uploaded package, safety package, failed candidate, and journal if rollback fails.
5. Do not edit `_sqlx_migrations` on the live database. Ledger verification or reconstruction is permitted only in an isolated candidate after its complete source schema contract passes.

The container healthcheck treats an active restore supervisor as healthy so an external container manager does not interrupt the short swap window. Public `/health` remains available during candidate preparation and unavailable only while the API is intentionally stopped for swap or rollback.

For disposable fault-injection drills, set `RIVIAMIGO_RESTORE_FAULT_PHASE` to one of `package_validated`, `timescale_pre_restore`, `dump_restored`, `compatibility_transform`, `target_migrations`, `candidate_validated`, `safety_backup`, `history_merged`, `database_swapped`, `artwork_activated`, or `health_verification`. Never enable this variable on a production installation. Pre-swap faults must leave the live database untouched; post-swap faults must report a successful rollback and restore health.

The package does not restore Redis live state, browser state, refresh sessions, provider credentials, installation keys, or S3 secrets. In-app restores preserve the existing host's backup catalog and operational history through the restore journal. Remote packages are downloaded beneath `/backups/.remote-staging`, fully validated before the safety backup begins, and removed by the restore supervisor when the job completes or fails.

## S3 recovery drill

Run `pnpm verify:backup-restore-s3 -- --source-build` for the optional destructive-path acceptance test. It creates isolated Compose projects and a disposable Garage object store, publishes one package to Local and S3, removes the local source package, discovers the remote object from a clean installation, and completes an in-app restore. The command is intentionally excluded from routine `pnpm test`; maintainers can also run the manual **S3 backup and restore drill** GitHub Actions workflow.

An S3-enabled run is successful only when the upload and retention operations succeed. A failed upload leaves a local fallback package and a failed run record. Investigate the run error, use **Test S3 connection**, and rerun manually after repairing credentials, endpoint routing, or bucket permissions.

## PostgreSQL 16 to 18 cutover

1. Create a Riviamigo recovery package and restore it into an isolated stack before touching the source installation.
2. Create a raw PostgreSQL 16 custom-format dump with `pg_dump -Fc` and record its SHA-256.
3. Stop the source stack and preserve the entire PG16 data directory as a rollback artifact.
4. Initialize a new, empty PostgreSQL 18/TimescaleDB 2.28.3 volume. Do not reuse or mount the PG16 data directory.
5. Restore the dump, run migrations, and verify the Timescale extension, hypertables, continuous aggregates, refresh policies, table row counts, and sampled telemetry.
6. Create a new recovery package from the upgraded stack and restore it into a second empty stack.
7. Retain the PG16 dump and directory until the second restore and application smoke tests pass.

Redis is handled separately. Snapshot the Redis 7 directory before starting Redis 8. If Redis 8 cannot read it, replace only the Redis directory and document that sessions and provider connections must be recreated.
