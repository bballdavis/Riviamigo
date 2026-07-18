---
title: Configuration
description: Configure the minimal production values and optional Riviamigo settings.
slug: /getting-started/configuration/
---

# Configuration

The standard Compose file reads the repository-root `.env` inside the unified app container. Keep real values out of Git and use a secret manager where your host supports one.

Start with [`compose/.env.example`](../../compose/.env.example). It contains only the three values a normal installation needs. [`compose/.env.full.example`](../../compose/.env.full.example) is the complete override template, while the [environment-variable reference](../environment-variables.md) documents every supported value, default, and scope.

## Required for production

Set these before starting `compose/docker-compose.yml`:

- `POSTGRES_PASSWORD` — a strong database password; the app safely constructs its internal database URL from it.
- `REDIS_PASSWORD` — a separate strong password.
- `ALLOWED_ORIGINS` — the exact public HTTPS origin used by your authenticated gateway, such as `https://riviamigo.example.net`.

Riviamigo defaults to production mode; no production flag is required in `.env`.

On first startup, Riviamigo generates its JWT signing pair and age encryption identity and stores them in PostgreSQL. They therefore survive normal restarts and recovery-package restores. Advanced deployments may supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` together; partial overrides are rejected, and rotating the age key without migrating encrypted values can make stored credentials unreadable.

## Optional settings

Weather, geocoding, basemap, and Iconify policies are configured in **Settings > External Connections** and stored in the database. Do not add provider URLs or API keys to `.env`; custom connection secrets are encrypted with the installation age key and remain write-only. See [external connections](./external-connections.md).

- `RIVIAMIGO_ORIGIN_PORT` changes the published app port from `8080`.
- `IMAGE_TAG` selects a published release and defaults to `latest`.
- `RIVIAMIGO_IMAGE_REGISTRY` defaults to `ghcr.io/bballdavis`.
- `BACKUP_DRIVER`, `BACKUP_ARTIFACT_DIR`, and `BACKUP_POLL_INTERVAL_SECONDS` tune recovery packages; normal Compose already uses `/backups`.
- Reconnect, telemetry-retention, logging, and rate-limit settings are available in the [complete reference](../environment-variables.md).

The active `.env` and `.env.local` files remain ignored by Git.
