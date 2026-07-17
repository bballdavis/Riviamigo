---
title: Backup and restore
description: Create, verify, download, and restore complete Riviamigo recovery packages.
slug: /operations/backup-and-restore/
---

# Backup and restore

Riviamigo recovery packages are full durable-state packages. They include the PostgreSQL database and the persistent vehicle artwork cache, so a downloaded package can be restored into a clean installation running the same or a newer Riviamigo release.

Redis live snapshots, browser storage, refresh sessions, Rivian/provider credentials, installation keys, backup target secrets, and old backup catalog entries are intentionally not restored. Non-secret backup scheduling and target configuration is restored; reconnect providers and re-enter the backup target secret after a restore.

## Create and download a recovery package

Open **Settings > Backups** and choose **Run now**. A successful run creates a file ending in `.rma.tar.gz`. Download that file and store it outside the host running Riviamigo. The local artifact volume is useful for operational retention, but it is not an off-host disaster-recovery copy until you download or copy it elsewhere.

Every package contains:

- `manifest.json` with the package format, source release, migration version, scope, redactions, and checksums.
- `database.dump`, a custom-format PostgreSQL dump with sensitive and ephemeral data excluded.
- `backup-settings.json`, containing non-secret backup schedule and target configuration.
- `vehicle-image-cache/`, containing the persistent first-party vehicle artwork mirror.

The API must have `pg_dump` available. `BACKUP_DRIVER=json` is no longer a valid recovery mode and is rejected as manifest-only metadata.

## Restore into a new installation

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
4. Restores the vehicle artwork cache volume.
5. Starts the API and web services and verifies health plus the restored setup state.

Use `--force` only when intentionally replacing the target installation:

```bash
node scripts/restore-backup.mjs \
  --package ./backup.rma.tar.gz \
  --env-file ./.env \
  --force
```

The restore command does not restore Rivian credentials or live sessions. After it completes, sign in as an administrator and reconnect the Rivian account and any other external providers. Configure off-site backup storage separately; the current worker writes and verifies local recovery packages but does not upload them to S3.

## Persistent artifact storage

Production Compose mounts `/backups` as a dedicated backup-artifact volume and uses it for `BACKUP_ARTIFACT_DIR`. Keep this volume separate from the PostgreSQL and artwork volumes. For disaster recovery, copy downloaded packages to a different host or storage system.

## Compatibility and verification

Recovery is forward-compatible: an older package may be restored into a newer release, which then runs its pending migrations. Downgrading is not supported.

Before relying on a package, restore it into an isolated installation and verify users, dashboards, vehicles, telemetry, trips, charging history, artwork, and application health. Treat packages as sensitive because they contain account, location, and vehicle history.
