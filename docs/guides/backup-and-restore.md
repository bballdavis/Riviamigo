---
title: Backup and restore
description: Create, verify, download, and restore complete Riviamigo recovery packages.
slug: /operations/backup-and-restore/
---

# Backup and restore

Riviamigo recovery packages are full durable-state packages. They include the PostgreSQL database and the persistent vehicle artwork cache, so a downloaded package can be restored into a clean installation running the same or a newer Riviamigo release.

Redis live snapshots, browser storage, refresh sessions, Rivian/provider credentials, installation keys, and backup target secrets are intentionally not restored. Non-secret backup scheduling and target configuration is restored; reconnect providers and re-enter the backup target secret after a restore. During an in-place restore, Riviamigo preserves the host's local backup catalog, backup execution history, and restore request history outside PostgreSQL and merges them into the restored database after startup. A clean-install restore only has the history contained on that target host.

## Create and download a recovery package

Open **Settings > Backups** and choose **Run now**. A successful run creates a file ending in `.rma.tar.gz`. Download that file and store it outside the host running Riviamigo. The local `./data/backups` directory is useful for operational retention, but it is not an off-host disaster-recovery copy until you download or copy it elsewhere.

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
5. Reconciles the persistent local backup catalog, execution history, and completed restore request into the restored database.
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

The in-app flow and host command do not restore Rivian credentials or live sessions. After completion, sign in as an administrator and reconnect the Rivian account and any other external providers. Configure off-site backup storage separately; the current worker writes and verifies local recovery packages but does not upload them to S3.

## Persistent artifact storage

Production Compose mounts the host-visible `./data/backups` directory at `/backups` and uses it for generated, imported, safety, and restore-job artifacts. PostgreSQL lives in `./data/db`, while artwork is under `./data/cache`. Imported and safety packages are excluded from ordinary scheduled-backup retention and require explicit deletion. For disaster recovery, copy downloaded packages to a different host or storage system.

## Compatibility and verification

Recovery is forward-compatible: an older package may be restored into a newer release, which then runs its pending migrations. Downgrading is not supported.

Before relying on a package, restore it into an isolated installation and verify users, dashboards, vehicles, telemetry, trips, charging history, artwork, and application health. Treat packages as sensitive because they contain account, location, and vehicle history.
