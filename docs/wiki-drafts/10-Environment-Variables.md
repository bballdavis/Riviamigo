# Environment Variables

This page documents all environment variables used by Riviamigo. Copy `.env.example` to `.env` and fill in the values appropriate for your deployment.

Variables marked **Required** must be set. Variables marked **Optional** have defaults or are only needed for specific features.

---

## Environment Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RIVIAMIGO_ENV` | Optional | `development` | Set to `production` for production deployments. Affects cookie security settings and logging verbosity. |

---

## Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Required** | — | PostgreSQL connection string. Example: `postgresql://riviamigo:password@timescaledb:5432/riviamigo`. Must point to a TimescaleDB instance. |

---

## Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | **Required** | — | Redis connection string. Example: `redis://localhost:6379`. Used for session state, OTP challenges, and refresh token rotation locking. |
| `REDIS_PASSWORD` | Optional | — | Redis password if your instance requires authentication. |

---

## Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COOKIE_INSECURE` | Optional | `0` | Set to `1` in development only to allow the refresh cookie to be sent over plain HTTP. **Never set this in production.** |

> ⚠️ **Warning:** Setting `COOKIE_INSECURE=1` in production exposes auth cookies over unencrypted connections and is a serious security risk. This flag exists only for local development without HTTPS.

---

## JWT and Encryption Keys

All three keys are auto-generated on first API boot and stored in the `system_config` database table. You only need to set these explicitly if you want to manage your own keys (for example, to rotate them or share them across multiple API instances).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Optional | Auto-generated | RSA private key PEM content. Used to sign JWT access tokens (RS256). |
| `JWT_PUBLIC_KEY` | Optional | Auto-generated | RSA public key PEM content. Used to verify JWT access tokens. |
| `AGE_ENCRYPTION_KEY` | Optional | Auto-generated | age X25519 secret key (`AGE-SECRET-KEY-...` format). Used to encrypt Rivian credentials at rest. |

> **Note:** If you change `AGE_ENCRYPTION_KEY` after credentials have been stored, existing Rivian credentials in the database will be unreadable. You will need to re-enter them via the UI.

---

## Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | Optional | `3001` | Port the Rust API listens on. |
| `ALLOWED_ORIGINS` | Optional | `http://localhost:3000` | Comma-separated list of allowed CORS origins. Set to your public URL in production. Example: `https://riviamigo.yourdomain.com`. |

---

## S3 / Object Storage (Backup)

These variables enable database backups to an S3-compatible object store. Leave unset if you do not want S3 backups.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `S3_ENDPOINT` | Optional | — | S3-compatible endpoint URL. Example: `http://garage:3900` (local Garage) or `https://s3.us-east-1.amazonaws.com`. |
| `S3_ACCESS_KEY` | Optional | — | S3 access key ID. |
| `S3_SECRET_KEY` | Optional | — | S3 secret access key. |

---

## Backup Tuning

These variables control backup behavior (if the backup subsystem is enabled).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKUP_DRIVER` | Optional | `local` | Backup storage driver. Use `s3` to push backups to object storage. |
| `BACKUP_ARTIFACT_DIR` | Optional | `/data/backups` | Local directory for backup files when `BACKUP_DRIVER=local`. |
| `BACKUP_POLL_INTERVAL_SECONDS` | Optional | — | How often (in seconds) the backup task runs. |

---

## Rivian WebSocket Tuning

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RIVIAN_WS_RECONNECT_INITIAL_SECONDS` | Optional | — | Initial backoff delay (seconds) before the first WebSocket reconnect attempt. |
| `RIVIAN_WS_RECONNECT_MAX_SECONDS` | Optional | — | Maximum backoff delay (seconds) for WebSocket reconnect attempts. |

---

## Rivian Telemetry

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RIVIAN_RAW_EVENT_RETENTION_DAYS` | Optional | — | Number of days to retain raw telemetry events in `timeseries.telemetry` before dropping. Leave unset to retain indefinitely. |
| `RIVIAN_PERSIST_RAW_EVENTS` | Optional | `true` | Set to `false` to skip writing raw WebSocket events to the database (derived data only). |
| `RIVIAN_SUPPRESS_DUPLICATE_TELEMETRY` | Optional | `true` | When `true`, consecutive telemetry pushes with no changed values are not written to the database. Reduces storage significantly for parked vehicles. |

---

## Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUST_LOG` | Optional | `info` | Log level filter for the Rust API. Example: `riviamigo_api=debug,tower_http=info`. See [env_logger documentation](https://docs.rs/env_logger) for filter syntax. |

---

## Example `.env` for Production

```env
DATABASE_URL=postgresql://riviamigo:STRONG_PASSWORD@timescaledb:5432/riviamigo
REDIS_URL=redis://redis:6379

PORT=3001
ALLOWED_ORIGINS=https://riviamigo.yourdomain.com

RIVIAMIGO_ENV=production

RUST_LOG=riviamigo_api=info,tower_http=warn
```

Leave JWT/age keys unset to let the API auto-generate them. Set `S3_*` variables if you want offsite backups.
