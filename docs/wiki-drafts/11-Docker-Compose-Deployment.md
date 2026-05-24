# Docker Compose Deployment

This page covers deploying Riviamigo in production using Docker Compose. For a faster path that skips the detail, see [Quick Start](Quick-Start).

---

## Overview

The production Compose file (`infra/docker-compose.prod.yml`) defines:

- **timescaledb** — TimescaleDB (PostgreSQL + time-series extension)
- **redis** — Redis for session state and token locking
- **api** — the Rust API container (port 3001)
- **web** — the React frontend served by Nginx (port 3000)

> **Note:** The development Compose file (`infra/docker-compose.yml`) also includes a Garage S3-compatible object store container for local testing. This is not included in the production file. If you want S3 backups in production, point the `S3_*` env vars at an external store (MinIO, Backblaze B2, Cloudflare R2, etc.).

---

## Initial Deployment

### 1. Prepare your environment file

```bash
cp .env.example .env
```

Edit `.env` and set:

- `DATABASE_URL` — with a strong password (not the dev default)
- `ALLOWED_ORIGINS` — your public URL (e.g. `https://riviamigo.yourdomain.com`)
- `RIVIAMIGO_ENV=production`
- `RUST_LOG=riviamigo_api=info,tower_http=warn`

Leave JWT/age keys blank — they are auto-generated on first boot.

> ⚠️ **Warning:** Never use `devpassword` or any other weak password in production. If your TimescaleDB port is exposed to the network, a weak password is a serious vulnerability.

### 2. Start the stack

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

The API container runs database migrations automatically on startup. The first boot may take 30–60 seconds while TimescaleDB initializes.

### 3. Verify the stack is running

```bash
docker compose -f infra/docker-compose.prod.yml ps
```

All containers should show `Up` or `Up (healthy)`.

Check the API health endpoint:

```bash
curl http://localhost:3001/health
```

Should return `200 OK`.

---

## Reverse Proxy (HTTPS)

For production use, place a reverse proxy in front of the stack. Example Caddy configuration:

```
riviamigo.yourdomain.com {
    reverse_proxy /v1/* localhost:3001
    reverse_proxy /* localhost:3000
}
```

Update `ALLOWED_ORIGINS` in `.env` to match your public URL and restart the API:

```bash
docker compose -f infra/docker-compose.prod.yml restart api
```

---

## Updating

To pull new images and restart with zero data loss:

```bash
docker compose -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.prod.yml up -d
```

The API runs migrations automatically on startup, so schema changes are applied automatically.

---

## Viewing Logs

```bash
# Follow all services
docker compose -f infra/docker-compose.prod.yml logs -f

# API only
docker compose -f infra/docker-compose.prod.yml logs -f api

# Last 100 lines of the web container
docker compose -f infra/docker-compose.prod.yml logs --tail=100 web
```

---

## Stopping the Stack

```bash
# Stop containers but keep data volumes
docker compose -f infra/docker-compose.prod.yml down

# Stop and remove all data (DESTRUCTIVE — deletes all telemetry)
docker compose -f infra/docker-compose.prod.yml down -v --remove-orphans
```

---

## Backup and Restore

### Manual database backup

```bash
docker compose -f infra/docker-compose.prod.yml exec timescaledb \
  pg_dump -U riviamigo -Fc riviamigo > riviamigo_backup_$(date +%Y%m%d).dump
```

This creates a compressed custom-format dump. Store this file securely — it contains age-encrypted Rivian credentials.

### Restore

1. Stop the API to prevent writes:
   ```bash
   docker compose -f infra/docker-compose.prod.yml stop api
   ```

2. Restore the dump:
   ```bash
   docker compose -f infra/docker-compose.prod.yml exec -T timescaledb \
     pg_restore -U riviamigo -d riviamigo --clean < riviamigo_backup_YYYYMMDD.dump
   ```

3. Restart the API:
   ```bash
   docker compose -f infra/docker-compose.prod.yml start api
   ```

> **Note:** TimescaleDB backups must be restored to the same major TimescaleDB version. Check the version with `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';` before attempting a cross-version restore.

For automated and S3-backed backups, see [Backup and Restore](Backup-and-Restore).

---

## Ports Reference

| Port | Service | Notes |
|------|---------|-------|
| 3000 | Nginx (web frontend) | Public — expose via reverse proxy |
| 3001 | Rust API | Public — expose via reverse proxy |
| 5432 | TimescaleDB | Internal only — do not expose |
| 6379 | Redis | Internal only — do not expose |
