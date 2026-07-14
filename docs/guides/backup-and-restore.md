# Backup and restore

Your TimescaleDB volume holds Riviamigo's application data, telemetry, dashboards, and encrypted Rivian credentials. Treat every backup as sensitive data.

## Create a database backup

From the repository root:

```bash
docker compose --env-file .env -f compose/docker-compose.yml exec -T timescaledb \
  pg_dump -U "$POSTGRES_USER" -Fc riviamigo > riviamigo-$(date +%Y%m%d-%H%M%S).dump
```

Set `POSTGRES_USER` in your shell or replace it with the database user from `.env`. Store the resulting dump somewhere access-controlled and, ideally, separate from the host.

Before relying on a backup, test that it is readable:

```bash
pg_restore --list riviamigo-YYYYMMDD-HHMMSS.dump
```

## Restore a backup

Restoring replaces database data. Stop the API first and test this process on a non-production copy when possible.

```bash
docker compose --env-file .env -f compose/docker-compose.yml stop api
docker compose --env-file .env -f compose/docker-compose.yml exec -T timescaledb \
  pg_restore -U "$POSTGRES_USER" -d riviamigo --clean --if-exists --no-owner < riviamigo-YYYYMMDD-HHMMSS.dump
docker compose --env-file .env -f compose/docker-compose.yml start api
```

Use the same PostgreSQL and TimescaleDB major versions as the source where possible. A version change needs the relevant PostgreSQL/TimescaleDB upgrade procedure rather than a blind restore.

## Built-in backup artifacts

Riviamigo can run its backup task with `BACKUP_DRIVER=pg_dump` (the default) when `pg_dump` is available in the API runtime, or `BACKUP_DRIVER=json` for a manifest-only fallback. `BACKUP_ARTIFACT_DIR` controls where those artifacts are written. The production API uses a temporary filesystem by default, so arrange persistent, protected storage if you enable scheduled artifacts.

S3-compatible endpoints are only used when you configure their `S3_*` values. They become another third party with access to your backup data; see [privacy](../privacy.md).

After changing an off-site target, open **Settings > Backups** and **Settings > External Connections**, run the non-destructive verification, and confirm the last verification result before enabling scheduled uploads. The probe must not create or delete backup objects; credentials remain write-only.
