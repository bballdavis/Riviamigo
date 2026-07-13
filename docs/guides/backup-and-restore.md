# Backup and Restore

This page covers how to back up and restore your Riviamigo database, including TimescaleDB-specific considerations.

> ⚠️ **Security warning:** Database backups contain your age-encrypted Rivian credentials. Protect backup files as you would any sensitive credential store. Use encrypted storage or access-controlled S3 buckets.

---

## What to Back Up

The only stateful component that needs backing up is the **TimescaleDB database**. All application state (telemetry, trips, charge sessions, user accounts, credentials, dashboard configs) lives in the database.

Redis state is ephemeral — it holds active session data and will rebuild itself after a restart.

---

## Local Backup (pg_dump)

### Manual backup

Run a `pg_dump` against the running TimescaleDB container:

```bash
docker compose -f infra/docker-compose.prod.yml exec timescaledb \
  pg_dump -U riviamigo -Fc riviamigo > riviamigo_backup_$(date +%Y%m%d_%H%M%S).dump
```

This produces a compressed custom-format dump file. The `-Fc` flag creates a format that `pg_restore` can use for parallel, selective restoration.

### Automated local backups

You can schedule the above command as a cron job on the host:

```cron
0 3 * * * docker compose -f /path/to/riviamigo/infra/docker-compose.prod.yml exec -T timescaledb pg_dump -U riviamigo -Fc riviamigo > /backups/riviamigo_$(date +\%Y\%m\%d).dump
```

Set `BACKUP_ARTIFACT_DIR` in your `.env` to specify where backup files are stored if the API's built-in backup task is enabled.

---

## S3 Backup

To push backups to an S3-compatible object store, set the following in your `.env`:

```env
BACKUP_DRIVER=s3
S3_ENDPOINT=https://your-s3-endpoint
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
```

Compatible stores include:
- **Garage** — included in the dev Compose file for testing
- **MinIO** — self-hosted, production-grade
- **Backblaze B2** — cost-effective cloud option
- **Cloudflare R2** — S3-compatible, no egress fees
- **AWS S3** — standard option

After setting `BACKUP_DRIVER=s3`, restart the API. The built-in backup task will push dumps to the configured bucket on its schedule.

---

## Triggering a Manual Backup

If the API's backup task is running, you can trigger an immediate backup via the API:

```bash
curl -X POST http://localhost:3001/v1/admin/backup \
  -H "Authorization: Bearer <your-api-key>"
```

> **Note:** The admin backup endpoint may require elevated privileges. Check the API documentation for the current release.

---

## Restore Procedure

### 1. Stop the API

Prevent the API from writing to the database during restore:

```bash
docker compose -f infra/docker-compose.prod.yml stop api
```

### 2. Drop and recreate the database (optional)

For a clean restore, drop the existing database:

```bash
docker compose -f infra/docker-compose.prod.yml exec timescaledb \
  psql -U riviamigo -d postgres -c "DROP DATABASE IF EXISTS riviamigo;"
docker compose -f infra/docker-compose.prod.yml exec timescaledb \
  psql -U riviamigo -d postgres -c "CREATE DATABASE riviamigo;"
```

### 3. Restore from dump

```bash
docker compose -f infra/docker-compose.prod.yml exec -T timescaledb \
  pg_restore -U riviamigo -d riviamigo --no-owner < riviamigo_backup_YYYYMMDD.dump
```

### 4. Restart the API

```bash
docker compose -f infra/docker-compose.prod.yml start api
```

The API will run any pending migrations on startup. If the backup was from the same schema version, this is a no-op.

---

## TimescaleDB Version Compatibility

TimescaleDB backups are sensitive to version mismatches.

- A dump taken from TimescaleDB 2.x **cannot** be restored to TimescaleDB 2.x with a different minor version without following the TimescaleDB upgrade procedure.
- Always restore to the **same TimescaleDB version** as the source.

Check the version before restoring:

```bash
# On source
docker compose exec timescaledb psql -U riviamigo -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';"

# On target
docker compose exec timescaledb psql -U riviamigo -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';"
```

If the versions differ, consult the [TimescaleDB upgrade documentation](https://docs.timescale.com/self-hosted/latest/upgrades/) before restoring.

---

## Backup Checklist

Before any major update or destructive operation, verify:

- [ ] A recent backup exists and is not corrupt (`pg_restore --list backup.dump` should list objects without errors).
- [ ] The backup file is stored off the server (S3, NAS, external drive).
- [ ] You know which TimescaleDB version the backup came from.
- [ ] The backup file is stored securely (encrypted at rest or in an access-controlled location).
