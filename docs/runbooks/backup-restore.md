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

## Incident restore

1. Preserve the recovery package and record its SHA-256 before using it.
2. Prepare the target host with the same or newer Riviamigo release and a valid Compose env file.
3. Stop or isolate any existing application services.
4. Run `scripts/restore-backup.mjs` without `--force` first. It must refuse a target that already contains users.
5. Use `--force` only after confirming the target is disposable or intentionally being replaced.
6. Wait for the health check and complete provider re-authentication.
7. Download a fresh recovery package from the restored installation after verifying it.

## In-app restore diagnostics

The unified production image runs nginx, the API, and a local-only restore supervisor. A restore job is journaled under `/backups/.restore-jobs`; nginx proxies its capability-token status endpoint even while the API process is intentionally stopped. The supervisor never receives Docker access and does not restart PostgreSQL or Redis.

For an in-app restore:

1. Confirm the package finishes import validation before starting the restore.
2. Confirm the required safety package is written under the backup volume before the API stops.
3. Follow the phase shown in the UI or inspect the matching `.restore-jobs/<job-id>.json` file on the host.
4. If restoration fails, preserve both the uploaded and safety packages. The supervisor removes the maintenance marker and attempts to relaunch the API so diagnostics remain available.
5. If the API does not recover, use the safety package with `scripts/restore-backup.mjs --force` after preserving PostgreSQL and artwork storage.

The container healthcheck treats an active restore supervisor as healthy so an external container manager does not interrupt the destructive window. Public `/health` remains unavailable until the restored API is ready.

The package does not restore Redis live state, browser state, refresh sessions, provider credentials, installation keys, or old backup artifact history. S3 upload is not currently performed by the backup worker; retain a downloaded package on separate storage.

## PostgreSQL 16 to 18 cutover

1. Create a Riviamigo recovery package and restore it into an isolated stack before touching the source installation.
2. Create a raw PostgreSQL 16 custom-format dump with `pg_dump -Fc` and record its SHA-256.
3. Stop the source stack and preserve the entire PG16 data directory as a rollback artifact.
4. Initialize a new, empty PostgreSQL 18/TimescaleDB 2.28.3 volume. Do not reuse or mount the PG16 data directory.
5. Restore the dump, run migrations, and verify the Timescale extension, hypertables, continuous aggregates, refresh policies, table row counts, and sampled telemetry.
6. Create a new recovery package from the upgraded stack and restore it into a second empty stack.
7. Retain the PG16 dump and directory until the second restore and application smoke tests pass.

Redis is handled separately. Snapshot the Redis 7 directory before starting Redis 8. If Redis 8 cannot read it, replace only the Redis directory and document that sessions and provider connections must be recreated.
