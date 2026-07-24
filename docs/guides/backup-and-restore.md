---
title: Backup and restore
description: Create, verify, download, and restore complete Riviamigo recovery packages.
slug: /operations/backup-and-restore/
---

# Backup and restore

Riviamigo recovery packages are full durable-state packages. They include the PostgreSQL database and the persistent vehicle artwork cache, so a downloaded package can be restored into a clean installation running the same or a newer Riviamigo release.

Redis live snapshots, browser storage, refresh sessions, Rivian/provider credentials, provider connection activity history, installation keys, and backup target secrets are intentionally not restored. Non-secret backup scheduling and target configuration is restored; reconnect providers and re-enter the backup target secret after a restore. During an in-place restore, Riviamigo preserves the host's backup catalog, backup execution history, and restore request history outside PostgreSQL and merges them into the restored database after startup. A clean installation can rebuild its S3 catalog from the configured bucket.

## Create and download a recovery package

Open **Settings > Backups** and enable Local, S3, or both. Local retains a `.rma.tar.gz` package under `./data/backups`; S3 uploads the same verified package to the configured bucket and prefix. At least one destination is required. Use **Test S3 connection** after saving S3 settings to prove list, write, read, and delete access before relying on the schedule. Backup times use the shared application timezone configured by an administrator under **Settings > Units > Time zone**.

If S3 is an enabled destination and its upload fails, the run is marked failed and Riviamigo retains the valid package locally even when Local retention was disabled. This prevents a remote-storage outage from silently appearing as a protected backup.

The cutover release uses the `riviamigo-recovery-v3` contract and contains:

- `manifest.json` with the source release/build, PostgreSQL and TimescaleDB versions, migration chain identifier, complete ordered migration ledger and raw-byte SHA-384 checksums, compiled catalog digest, versioned canonical schema-contract digest, component policies, redactions, sizes, and checksums.
- `database.dump`, a custom-format PostgreSQL dump with sensitive and ephemeral data excluded.
- `backup-settings.json`, containing non-secret backup schedule and target configuration.
- `operational-history.json`, containing a sanitized, independently versioned snapshot of backup runs, artifact metadata, and restore requests.
- `vehicle-image-cache/`, containing the persistent first-party vehicle artwork mirror.

The API must have `pg_dump` available. `BACKUP_DRIVER=json` is no longer a valid recovery mode and is rejected as manifest-only metadata.

## Import and restore in the app

On the target installation, sign in as an administrator and open **Settings > Backups**. In **Restore from backup**, choose a package from the local catalog or select **Import recovery package** to upload a `.rma.tar.gz` file from another Riviamigo server. Wait for upload and package validation to finish. Uploaded packages have no artificial size limit, but the backup filesystem must have enough space for the package, validation staging, and the required safety backup. Any tunnel or reverse proxy in front of Riviamigo must also permit streaming uploads of the package size you use.

Select **Restore selected backup**. Riviamigo first performs an authenticated compatibility preflight and shows the source and target chain identities, schema heads, pending migrations, warnings, or a stable blocking reason. A source with an exact ledger prefix is upgraded normally. A v3 archive with historical SQLx bookkeeping may also proceed, but only after its isolated candidate matches both the archive's declared schema fingerprint and the immutable public baseline contract. Starting the restore requires that exact plan ID and package checksum. Review the replacement warning and type `RESTORE`. Riviamigo then:

1. Restores PostgreSQL and TimescaleDB into an isolated candidate while the current application remains available.
2. Verifies the actual source schema and migration ledger, reconstructs SQLx bookkeeping only inside the isolated candidate, runs pending forward migrations, and validates required relations, constraints, indexes, hypertables, policies, checksums, and foreign keys.
3. Creates and verifies a fresh safety recovery package only after the candidate is ready. The restore stops if this fails.
4. Merges source operational history with the target host snapshot; target records win UUID conflicts and the host catalogs determine physical package availability.
5. Stops the API and ingestion workers, then atomically activates the candidate database and versioned artwork directory.
6. Starts the API and verifies health, setup state, migrations, and restored data. A failed verification automatically swaps the previous database and artwork back.
7. Reconciles the durable journal and reloads the browser. Sign in with an account from the restored backup if prompted.

PostgreSQL and Redis remain running during this workflow. The durable journal checkpoints candidate preparation, transforms, migrations, validation, safety backup, history merge, swap, verification, rollback, and completion. A restart resumes an idempotent phase or rebuilds only the candidate. Retryable failures are bounded; invalid or incompatible packages are terminal.

## Restore with the host command

Prepare the new installation and its `.env` file first. Use the same or newer application release, then run the restore before using the new installation:

```bash
node scripts/restore-backup.mjs \
  --package ./backup-20260715T120000Z-<run-id>.rma.tar.gz \
  --env-file ./.env
```

For a source checkout, add `--source-build`. The command:

1. Validates the archive, manifest, checksums, and archive paths.
2. Starts only PostgreSQL and refuses a database that already contains users.
3. Runs the same Rust compatibility planner, candidate engine, transforms, migrations, and validation report used by in-app restores.
4. Creates a safety package of the target host, merges its operational history, and atomically activates the validated database and artwork while retaining the previous state.
5. Starts the unified app service, verifies health plus setup state, and finalizes the swap; a failed verification invokes the shared rollback path.

Use `--force` only when intentionally replacing the target installation:

```bash
node scripts/restore-backup.mjs \
  --package ./backup.rma.tar.gz \
  --env-file ./.env \
  --force
```

The restore picker can browse Local, S3, or both catalogs. Selecting an S3 package downloads it into protected staging, validates its package and component checksums, creates the normal safety backup, and then hands it to the restore supervisor. A clean installation can therefore configure the original bucket, discover its Riviamigo packages, and restore without first copying the archive through a browser.

The in-app flow and host command do not restore Rivian credentials or live sessions. S3 secrets are also redacted from the package. After completion, sign in as an administrator, reconnect external providers, and re-enter the S3 secret unless the deployment supplies environment-backed credentials. Restored Rivian vehicles are marked as requiring reauthentication instead of retaining stale connected state. To resume vehicle telemetry, reconnect each Rivian vehicle from Settings; this stores encrypted credentials and restarts its ingestion worker. During an active charge, the worker publishes a short-lived live snapshot for the dashboard, while the live-session endpoint returns `204` when no current snapshot is available.

## Persistent artifact storage

Production Compose mounts the host-visible `./data/backups` directory at `/backups` and uses it for generated, imported, safety, remote-staging, and restore-job artifacts. PostgreSQL lives in `./data/db`, while artwork is under `./data/cache`. Restore never replaces or recreates the backup directory; startup and the Backups page rescan valid local packages and rebuild any missing catalog rows from disk. The retention count applies independently to generated Local and S3 packages. Imported and safety packages are never pruned by scheduled retention.

## Compatibility and verification

Recovery is forward-compatible through the versioned v3 schema contract. A recognized older v3 package with an exact catalog prefix is upgraded inside the isolated candidate. A v3 archive with a historical or unfamiliar ledger is never guessed at: its restored schema must match its declared fingerprint and the immutable public baseline before Riviamigo normalizes bookkeeping and applies forward migrations. Downgrades, unsupported package formats, schema-contract mismatches, incomplete schemas, incompatible PostgreSQL or TimescaleDB versions, and newer-source packages are rejected before swap.

The former five-migration pre-release chain remains a rollback path when a matching historical application image is available. A v3 archive from that era can be considered by the current restore engine only through the same candidate schema proof above; an incompatible candidate is rejected before activation. The explicit adoption command remains an operator action for a stopped installation: it verifies a recovery dump and complete canonical schema against a scratch baseline, then replaces only SQLx bookkeeping. It never replays baseline SQL on populated data and is never run automatically at startup, backup, or restore.

Matching migration numbers or visibly matching tables do not prove migration identity. The raw migration bytes, ordered catalog, chain identifier, and schema contract must all agree.

Before relying on a package, restore it into an isolated installation and verify users, dashboards, vehicles, telemetry, trips, charging history, artwork, and application health. Treat packages as sensitive because they contain account, location, and vehicle history.
