# Docker Compose Deployment

This page covers deploying Riviamigo in production using Docker Compose. For a faster path that skips the detail, see [Quick Start](Quick-Start).

---

## Overview

The production Compose file (`infra/docker-compose.prod.yml`) defines:

- **timescaledb** — TimescaleDB (PostgreSQL + time-series extension)
- **redis** — password-protected Redis for session state and token locking
- **api** — the Rust API container on the internal Docker network
- **nginx** — the React frontend and API origin, bound only to `127.0.0.1:8080`

Riviamigo is not approved for direct Internet exposure. Put an authenticated
tunnel or identity-aware reverse proxy in front of the loopback origin. A tunnel
without an access policy is not sufficient.

> **Note:** The development Compose file (`infra/docker-compose.yml`) also includes a Garage S3-compatible object store container for local testing. This is not included in the production file. If you want S3 backups in production, point the `S3_*` env vars at an external store (MinIO, Backblaze B2, Cloudflare R2, etc.).

---

## Initial Deployment

### 1. Prepare your environment file

```bash
cp .env.example .env
```

Edit `.env` and set:

- `DATABASE_URL` — with a strong password (not the dev default)
- `POSTGRES_PASSWORD` and `REDIS_PASSWORD` — strong unique values
- `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` — supplied from a secret manager or protected deployment environment
- `ALLOWED_ORIGINS` — your exact public HTTPS URL (for example, `https://riviamigo.yourdomain.com`)
- `RIVIAMIGO_ENV=production`
- `RUST_LOG=riviamigo_api=info,tower_http=warn`

Production startup rejects missing signing and encryption keys. Automatic key
generation is available only in development.

> ⚠️ **Warning:** Never use `devpassword` or any other weak password in production. If your TimescaleDB port is exposed to the network, a weak password is a serious vulnerability.

### 2. Start the stack

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

The API container runs database migrations automatically on startup. The first boot may take 30–60 seconds while TimescaleDB initializes.

### 2a. Create the first owner

Open the authenticated HTTPS URL. An empty installation presents **Set up
Riviamigo**; its first account becomes the `super_user` and is taken directly
to Rivian connection. Public registration closes immediately after that. Use
**Users → Invite user** to create an expiring activation link for additional
users, then share that link through your normal secure channel. Activation
tokens live in the URL fragment, so reverse-proxy access logs do not receive
them.

### 3. Verify the stack is running

```bash
docker compose -f infra/docker-compose.prod.yml ps
```

All containers should show `Up` or `Up (healthy)`.

Check the private origin health endpoint locally:

```bash
curl http://127.0.0.1:8080/health
```

Should return `200 OK`.

---

## Authenticated Gateway (HTTPS)

For production use, place an authenticated tunnel or identity-aware reverse
proxy in front of the stack. It must authenticate users before forwarding and
support WebSocket upgrades. Example origin target for Caddy or an Authentik
proxy-outpost integration:

```
riviamigo.yourdomain.com {
    reverse_proxy 127.0.0.1:8080
}
```

Use an identity policy in the gateway (for example, Authentik forward auth or
Cloudflare Access). Do not expose the loopback origin, API, database, or Redis
ports directly. See [Secure Deployment](Secure-Deployment) for the required
boundary.

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

# Last 100 lines of the origin container
docker compose -f infra/docker-compose.prod.yml logs --tail=100 nginx
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

## Fresh-install verification

Run the disposable verifier only from a clean, isolated worktree:

```bash
pnpm verify:fresh-install -- --mode all --production-env /secure/path/fresh-install.env
```

The caller-owned env file must contain valid production database, Redis, JWT,
age, and origin settings. The verifier starts a random Compose project,
confirms migration and `/health`, creates the first owner, confirms public
registration closes, then removes only its own containers and volumes.

## Ports Reference

| Port | Service | Notes |
|------|---------|-------|
| 8080 | Nginx origin | Loopback only; target from authenticated gateway |
| 3001 | Rust API | Internal Docker network only |
| 5432 | TimescaleDB | Internal only — do not expose |
| 6379 | Redis | Internal only — do not expose |
