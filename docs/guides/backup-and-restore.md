---
title: Backup and restore
description: Create, verify, download, and restore complete Riviamigo recovery packages.
slug: /operations/backup-and-restore/
---

# Backup and restore

Riviamigo recovery packages are full durable-state packages. They include the PostgreSQL database and the persistent vehicle artwork cache, so a downloaded package can be restored into a clean installation running the same or a newer Riviamigo release.

Redis live snapshots, browser storage, refresh sessions, Rivian/provider credentials, installation keys, and backup target secrets are intentionally not restored. Non-secret backup scheduling and target configuration is restored; reconnect providers and re-enter the backup target secret after a restore. During an in-place restore, Riviamigo preserves the host's backup catalog, backup execution history, and restore request history outside PostgreSQL and merges them into the restored database after startup. A clean installation can rebuild its S3 catalog from the configured bucket.

## Create and download a recovery package

Open **Settings > Backups** and enable Local, S3, or both. Local retains a `.rma.tar.gz` package under `./data/backups`; S3 uploads the same verified package to the configured bucket and prefix. At least one destination is required. Use **Test S3 connection** after saving S3 settings to prove list, write, read, and delete access before relying on the schedule.

If S3 is an enabled destination and its upload fails, the run is marked failed and Riviamigo retains the valid package locally even when Local retention was disabled. This prevents a remote-storage outage from silently appearing as a protected backup.

Every package contains:

- `manifest.json` with the package format, source release, migration version, scope, redactions, and checksums.
- `database.dump`, a custom-format PostgreSQL dump with sensitive and ephemeral data excluded.
- `backup-settings.json`, containing non-secret backup schedule and target configuration.
- `vehicle-image-cache/`, containing the persistent first-party vehicle artwork mirror.

The API must have `pg_dump` available. `BACKUP_DRIVER=json` is no longer a valid recovery mode and is rejected as manifest-only metadata.

## Import and restore in the app

On the target installation, sign in as an administrator and open **Settings > Backups**. In **Restore from backup**, choose a package from the local catalog or select **Import recovery package** to upload a `.rma.tar.gz` file from another Riviamigo server. Wait for upload and package validation to finish. Uploaded packages have no artificial size limit, but the backup filesystem must have enough space for the package, validation staging, and the required safety backup. Any tunnel or reverse proxy in front of Riviamigo must also permit streaming uploads of the package size you use.

Select **Restore selected backup**, review the replacement warning, and type `RESTORE`. Riviamigo then:

1. Creates and verifies a fresh safety recovery package of the target installation. The restore stops if this fails.
2. Stops the API and ingestion workers while keeping nginx and the restore-progress endpoint available.
3. Restores PostgreSQL, sanitized backup settings, and vehicle artwork.
4. Starts a fresh API process, applies pending migrations, and verifies health.
5. Reconciles the persistent backup catalog, execution history, and completed restore request into the restored database.
6. Reloads the browser into the restored installation. Sign in with an account from the restored backup if prompted.

PostgreSQL and Redis remain running during this workflow. The restored database does not require a PostgreSQL server restart, and Redis live state is not part of the recovery package.

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
3. Restores the database before starting the API, allowing the new release to apply pending migrations.
4. Restores the vehicle artwork cache directory.
5. Starts the unified app service and verifies health plus the restored setup state.

Use `--force` only when intentionally replacing the target installation:

```bash
node scripts/restore-backup.mjs \
  --package ./backup.rma.tar.gz \
  --env-file ./.env \
  --force
```

The restore picker can browse Local, S3, or both catalogs. Selecting an S3 package downloads it into protected staging, validates its package and component checksums, creates the normal safety backup, and then hands it to the restore supervisor. A clean installation can therefore configure the original bucket, discover its Riviamigo packages, and restore without first copying the archive through a browser.

The in-app flow and host command do not restore Rivian credentials or live sessions. S3 secrets are also redacted from the package. After completion, sign in as an administrator, reconnect external providers, and re-enter the S3 secret unless the deployment supplies environment-backed credentials.

## Persistent artifact storage

Production Compose mounts the host-visible `./data/backups` directory at `/backups` and uses it for generated, imported, safety, remote-staging, and restore-job artifacts. PostgreSQL lives in `./data/db`, while artwork is under `./data/cache`. The retention count applies independently to generated Local and S3 packages. Imported and safety packages are never pruned by scheduled retention.

## Compatibility and verification

Recovery is forward-compatible: an older package may be restored into a newer release, which then runs its pending migrations. Downgrading is not supported.

Before relying on a package, restore it into an isolated installation and verify users, dashboards, vehicles, telemetry, trips, charging history, artwork, and application health. Treat packages as sensitive because they contain account, location, and vehicle history.
