# Configuration

The production Compose file reads its values from `.env` or your deployment environment. Keep real values out of Git and use a secret manager where your host supports one.

## Required for production

Set these before starting `compose/docker-compose.prod.yml`:

- `DATABASE_URL` — use the Compose hostname `timescaledb`, for example `postgresql://riviamigo:YOUR_DATABASE_PASSWORD@timescaledb:5432/riviamigo`.
- `POSTGRES_USER` and `POSTGRES_PASSWORD` — credentials for the database container.
- `REDIS_PASSWORD` — a separate strong password.
- `JWT_SECRET` and `JWT_PUBLIC_KEY` — an RSA private/public signing-key pair.
- `AGE_ENCRYPTION_KEY` — the secret used to encrypt Rivian credentials at rest.
- `ALLOWED_ORIGINS` — the exact public HTTPS origin used by your authenticated gateway, such as `https://riviamigo.example.net`.
- `RIVIAMIGO_ENV=production`.

Production refuses to auto-generate signing or encryption keys. Keep those values stable: rotating them without a migration plan can invalidate sessions or make stored credentials unreadable.

## Optional settings

- `RIVIAMIGO_ORIGIN_PORT` changes the loopback listener from its default of `8080`.
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` configure an S3-compatible backup destination.
- `BACKUP_DRIVER`, `BACKUP_ARTIFACT_DIR`, and `BACKUP_POLL_INTERVAL_SECONDS` control the backup worker; see [backup and restore](./backup-and-restore.md).
- `RUST_LOG` changes server logging verbosity.

`.env.example` is a commented reference for the full set of supported settings. It has development defaults and placeholders, so it is a starting point—not a production-ready secret file.
