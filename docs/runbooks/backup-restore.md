# Backup and restore runbook

This runbook covers recovery-package validation and clean-install restore. The user-facing workflow is documented in [Backup and restore](../guides/backup-and-restore.md).

## Trust and privilege boundary

Restore only packages whose producer and contents you trust. Administrator
authorization does not make a PostgreSQL archive passive data. Candidate SQL
runs as a job-specific role without cluster administration, file/program roles
or privileges on other application objects. The role retains restored object
ownership and becomes NOLOGIN with its password removed after preparation.
Its candidate grants disappear when the database is dropped; orphan roles are
removed on cleanup. Startup also disables interrupted restore-role logins.
The outer restore deadline explicitly runs cleanup: it terminates the job
role's sessions, disables its login/password, force-drops only that job's
candidate, and removes the orphaned role. Cleanup uses the maintenance database
so a temporarily absent application database during a swap cannot skip it.
Never work around an import permission error by rerunning `pg_restore` as the
bootstrap superuser. Preserve the package and diagnose extension compatibility.

The bootstrap role preinstalls TimescaleDB, pgcrypto, cube and earthdistance,
runs known Timescale hooks and handles the database swap. This still shares the
PostgreSQL server; functions, background jobs and SQL resource consumption in
trusted archives remain accepted restore risk. A separate PostgreSQL sandbox
is outside this hardening change.

## Validate a package before an incident

Run the restore command against an isolated Compose project and a disposable env file:

```bash
node scripts/restore-backup.mjs \
  --package ./backup.rma.tar.gz \
  --env-file ./restore.env \
  --project riviamigo-backup-drill
```

Confirm that the restored instance contains the expected users, vehicles, dashboards, historical telemetry, trips, charging history, and vehicle artwork. Confirm that the Rivian account is disconnected and can be reconnected from Settings. Redis live state and encrypted `vehicle_credentials` are intentionally excluded, so a restored vehicle will not ingest telemetry or publish live charging data until it is reauthenticated.

Also verify that `riviamigo.charts` is present, bundled chart slugs are visible under **Settings > Charts**, and personal chart overrides still shadow their system rows. Run `pnpm charts:sync-defaults --check` before comparing a restore against the release source tree.

For repeatable regression of a private release checkpoint, use the gitignored restore lab:

```powershell
pnpm verify:restore-compatibility -- `
  --package C:\path\to\backup.rma.tar.gz `
  --source-build
```

The lab rechecks the package SHA-256, reads the expected source head and chain information from `manifest.json`, creates disposable Compose storage and credentials, verifies the API and restore supervisor, records a data-free report under `tools/restore-lab/local/reports/`, and removes the stack unless `--keep` is supplied. Add `--verify-rollback` to prepare and activate a second candidate, roll it back, and prove that the previous database and artwork return with a healthy application and durable rollback report. Never commit packages or lab credentials. Checkpoints from the former five-migration chain are expected rejection cases, not successful migration fixtures.

## Incident restore

1. Preserve the recovery package and record its SHA-256 before using it.
2. Prepare the target host with the same or newer Riviamigo release and a valid Compose env file.
3. Leave an existing application running while the command builds and validates its isolated candidate; the wrapper stops the app only after the candidate is ready for the atomic swap.
4. Run `scripts/restore-backup.mjs` without `--force` first. It must refuse a target that already contains users.
5. Use `--force` only after confirming the target is intentionally being replaced.
6. Wait for the health and setup-state checks and complete provider re-authentication.
7. Confirm that reauthentication repopulates `vehicle_credentials`, starts the vehicle worker, advances runtime/WS timestamps, and creates `vehicle:{vehicle_id}:live_session` during an active charge. The live-session API should return `200`; before the worker publishes a snapshot it correctly returns `204`.
8. Download a fresh recovery package from the restored installation after verifying it.

## In-app restore diagnostics

The unified production image runs nginx, the API, and a local-only restore supervisor. A restore job is journaled under `/backups/.restore-jobs`; nginx proxies its capability-token status endpoint even while the API process is intentionally stopped. Before handoff, that journal also snapshots the backup runs, artifact catalog, and restore request history. The restarted API merges the snapshot back after the supervisor marks the job complete. The supervisor never receives Docker access and does not restart PostgreSQL or Redis.

### Resource envelope and contention

Import and restore share a PostgreSQL-backed recovery-mutation lock; do not
start a second import, restore, or recovery intervention while one is active.
The imported package is streamed to a temporary artifact only after a free-space
check and is rechecked while receiving bytes. The default envelope is 16 GiB
compressed upload, 64 GiB expanded/member size, 10,000 members, 200:1 maximum
compression ratio, and at least 2 GiB free artifact storage. Manifest/settings
JSON each have an independent 1 MiB cap; operational history has a 16 MiB cap
and merges one record at a time. S3 downloads and internal restore copies enforce
the compressed cap, reserved free space and restore deadline while writing actual
bytes, even without Content-Length. Partial staging files are removed on failure. Upload has a
30-minute deadline; the restore supervisor has a four-hour deadline. Limits
are configuration, not estimates—an archive that exceeds any one is rejected.

Backup creation and restore preflight use UUID workspaces beneath
`BACKUP_ARTIFACT_DIR/.recovery-work` and remove them when the operation ends.
Preflight extraction uses the same configured recovery limits as activation;
dump inspection streams output with bounded diagnostic memory. Keep free
space on this volume for the package, extracted dump and safety backup. The
container's small `/tmp` filesystem is not recovery storage.

Migration 0030 includes the charge-payload backfill index in the canonical
schema. A freshly migrated candidate and an installation that has processed
historical payloads therefore retain the same strict schema fingerprint. Do not
bypass a fingerprint mismatch by removing indexes or disabling compatibility
validation; preserve the package and investigate the differing objects.

When a limit, free-space, or deadline error occurs, preserve the original
package and journal, correct the condition, and retry after the active lock has
cleared. Do not bypass the check by copying unvalidated content into staging.
The service rejects unsafe or duplicate paths and validates the entire package
before extraction or cataloging. Imported catalog rows are unavailable until
physical artifacts are verified, and all local reads/deletes reject traversal,
symlinks and service control paths outside the artifact contract.

For an in-app restore:

1. Confirm the package finishes import validation and preflight records the expected package checksum, chain/catalog identities, and source/target heads.
2. Confirm the isolated candidate reaches validation before the safety package is written and before the API stops.
3. Follow the phase shown in the UI or inspect `.restore-jobs/<job-id>.json` for the plan, candidate validation report, retryability, and rollback state.
4. If verification fails, confirm rollback state becomes `succeeded` and the previous API becomes healthy. Preserve the uploaded package, safety package, failed candidate, and journal if rollback fails.
5. Do not edit `_sqlx_migrations` manually. Normal ledger reconstruction occurs only in an isolated candidate after its source fingerprint and ledger are verified. A historical baseline package may precede the charts relation introduced in migration 11; forward migrations create it, and the final target contract always requires it. An unrecognized v3 ledger is accepted only when the restored physical schema exactly matches the immutable public baseline. Packages from the former five-migration chain are unsupported by the cutover release; use the explicit database-adoption runbook with a verified dump and matching old image instead. Partial or contradictory historical schemas fail closed.

The container healthcheck treats an active restore supervisor as healthy so an external container manager does not interrupt the short swap window. Public `/health` remains available during candidate preparation and unavailable only while the API is intentionally stopped for swap or rollback.

### Backup run diagnostics

Manual and scheduled backups are detached from the HTTP request. The start endpoint returns `202 Accepted`; use `GET /v1/admin/backups` and inspect the newest run's `status`, `phase`, `progress_percent`, `started_at`, and `error_message`. The Settings page performs this polling automatically while a run is pending or running. A stale `running` row after an API restart is reconciled to `failed` during startup; it does not represent active work. A second start returning `409 Conflict` means the existing backup worker still owns the PostgreSQL advisory lock.

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

## Restore authentication reset

Candidate sanitation runs after migrations even when an old or crafted dump
contains tables which a normal backup redacts. Re-enter provider and OIDC
settings, sign in with local password recovery, regenerate API keys and
invitations, and reconnect vehicles after restore. Installation environment
overrides remain operator authority and are not imported from the archive.
Backup prefixes must be portable relative components: no parent/dot segments,
absolute paths, backslashes, control characters or hidden control directories.
