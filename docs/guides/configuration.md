# Configuration

The production Compose file reads its values from `.env` or your deployment environment. Keep real values out of Git and use a secret manager where your host supports one.

Start with [`compose/.env.example`](../../compose/.env.example): it is the short template for a normal self-hosted installation. Copy it to `.env` at the repository root before running Compose. [`compose/.env.full.example`](../../compose/.env.full.example) is the complete reference for optional production tuning, direct API runs, and local development overrides; it is not the recommended starting point. Its development-only entries state where to set them instead of being added to a production `.env`.

## Required for production

Set these before starting `compose/docker-compose.prod.yml`:

- `DATABASE_URL` — use the Compose hostname `timescaledb`, for example `postgresql://riviamigo:YOUR_DATABASE_PASSWORD@timescaledb:5432/riviamigo`.
- `POSTGRES_USER` and `POSTGRES_PASSWORD` — credentials for the database container.
- `REDIS_PASSWORD` — a separate strong password.
- `JWT_SECRET` and `JWT_PUBLIC_KEY` — an RSA private/public signing-key pair.
- `AGE_ENCRYPTION_KEY` — the secret used to encrypt Rivian credentials at rest.
- `ALLOWED_ORIGINS` — the exact public HTTPS origin used by your authenticated gateway, such as `https://riviamigo.example.net`.

`compose/docker-compose.prod.yml` sets `RIVIAMIGO_ENV=production` itself.

Production refuses to auto-generate signing or encryption keys. Keep those values stable: rotating them without a migration plan can invalidate sessions or make stored credentials unreadable.

## Optional settings

- `RIVIAMIGO_ORIGIN_PORT` changes the loopback listener from its default of `8080`.
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` remain reserved configuration fields; the current backup workflow does not use an object-storage destination.
- `BACKUP_DRIVER`, `BACKUP_ARTIFACT_DIR`, and `BACKUP_POLL_INTERVAL_SECONDS` control the backup worker; see [backup and restore](./backup-and-restore.md).
- `RUST_LOG` changes server logging verbosity.
- The reconnect, telemetry-retention, and rate-limit settings in `compose/.env.full.example` are available when their defaults need tuning.

The short and full templates are intentionally kept beside the Compose files, while the active `.env` remains at the repository root and is ignored by Git.
