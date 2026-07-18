---
title: Environment variables
description: Complete reference for Riviamigo production, Compose, development, and frontend environment variables.
slug: /reference/environment-variables/
sidebar_label: Environment variables
---

# Environment variables

Most installations need only `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and `ALLOWED_ORIGINS`. Copy `compose/.env.example` to the repository-root `.env`; use `compose/.env.full.example` only as an override template. The standard production container reads that file directly, so supported optional values do not need matching entries in Compose.

## Standard production values

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `POSTGRES_PASSWORD` | Yes | None | Password shared by TimescaleDB and the app's generated internal connection URL. Any dotenv-safe value is URL-encoded by the app. |
| `REDIS_PASSWORD` | Yes | None | Password shared by Redis and the app's generated internal connection URL. |
| `ALLOWED_ORIGINS` | Yes | None in production | Comma-separated exact HTTPS browser origins. Paths, queries, fragments, and HTTP origins are rejected in production. |
| `POSTGRES_USER` | No | `riviamigo` | Database role used by production Compose. |
| `DATABASE_URL` | No | Built from `POSTGRES_USER` and `POSTGRES_PASSWORD` | Complete PostgreSQL URL. Overrides the standard Compose-derived URL and is required for direct API runs without `POSTGRES_PASSWORD`. |
| `REDIS_URL` | No | Built from `REDIS_PASSWORD` | Complete Redis URL. Overrides the standard Compose-derived URL and is required for direct API runs without `REDIS_PASSWORD`. |

## Image and Compose values

| Variable | Default | Purpose |
|---|---|---|
| `RIVIAMIGO_IMAGE_REGISTRY` | `ghcr.io/bballdavis` | Registry namespace containing the unified `riviamigo` image. |
| `IMAGE_TAG` | `latest` | Image tag; use a Calendar Version for repeatable deployments. |
| `RIVIAMIGO_ORIGIN_PORT` | `8080` | Host loopback port mapped to the unified app container. |
| `RIVIAMIGO_ENV_FILE` | `../.env` relative to `compose/docker-compose.yml` | Alternate dotenv file injected into the app container. Restore and verification scripts set this automatically. |

## Application security and runtime

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | Generated and stored in PostgreSQL | RSA private signing key. If overridden, the public and age keys must also be supplied. |
| `JWT_PUBLIC_KEY` | Generated and stored in PostgreSQL | RSA public verification key. Supply only as part of the complete three-key override. |
| `AGE_ENCRYPTION_KEY` | Generated and stored in PostgreSQL | age X25519 identity used to encrypt provider credentials. Supply only as part of the complete three-key override. |
| `RIVIAMIGO_ENV` | `production` in standard Compose | Enables production configuration validation. Use `development` only for local development. |
| `PORT` | `3001` | Internal API listener port. The unified production nginx expects `3001`. |
| `RUST_LOG` | `riviamigo_api=debug,tower_http=info` | Rust tracing filter. Standard production deployments normally set `info` when overriding it. |
| `COOKIE_INSECURE` | Unset | Allows non-Secure cookies for local development. Any value enables it; production rejects it. |
| `VEHICLE_IMAGE_CACHE_DIR` | Platform cache directory; `/cache/riviamigo/vehicle-images` in production Compose | Persistent local artwork mirror. A custom production path also needs a matching mount. |
| `BACKUP_DRIVER` | `pg_dump` | Recovery-package database exporter. Other values are rejected for full recovery packages. |
| `BACKUP_ARTIFACT_DIR` | `/backups` | Directory containing generated `.rma.tar.gz` recovery packages. |
| `BACKUP_POLL_INTERVAL_SECONDS` | `60` | Number of seconds between backup-scheduler checks. |
| `S3_ENDPOINT` | Unset | Reserved object-storage endpoint; the current recovery workflow does not upload to S3. |
| `S3_ACCESS_KEY` | Unset | Reserved object-storage access key. |
| `S3_SECRET_KEY` | Unset | Reserved object-storage secret key. |

Generated keys are part of the PostgreSQL backup and therefore survive restore. Supplying a new explicit age key to an existing database can make stored encrypted credentials unreadable; treat key changes as a migration.

## Rivian telemetry behavior

| Variable | Default | Purpose |
|---|---|---|
| `RIVIAN_GRAPHQL_GATEWAY_URL` | Rivian production GraphQL gateway | Diagnostic upstream override. Normal installations should not set it. |
| `RIVIAN_WS_RECONNECT_INITIAL_SECONDS` | `10` | Initial websocket reconnect delay. |
| `RIVIAN_WS_RECONNECT_MAX_SECONDS` | `900` | Maximum websocket reconnect delay. |
| `RIVIAN_RAW_EVENT_RETENTION_DAYS` | `7` | Raw telemetry retention window in days. |
| `RIVIAN_PERSIST_RAW_EVENTS` | `true` | Persists raw Rivian events for diagnostics and repair. |
| `RIVIAN_PARALLAX_CAPTURE_ENABLED` | `true` | Captures parallax data when supported by the upstream payload. |
| `RIVIAN_SUPPRESS_DUPLICATE_TELEMETRY` | `true` | Avoids storing unchanged duplicate telemetry samples. |

## API rate limits

All values must be positive integers. Per-minute settings control sustained traffic; burst settings control short spikes.

| Variable | Default |
|---|---:|
| `RATE_LIMIT_AUTH_PUBLIC_PER_MINUTE` | `30` |
| `RATE_LIMIT_AUTH_PUBLIC_BURST` | `10` |
| `RATE_LIMIT_AUTH_METADATA_PER_MINUTE` | `1200` |
| `RATE_LIMIT_AUTH_METADATA_BURST` | `120` |
| `RATE_LIMIT_AUTH_READ_PER_MINUTE` | `900` |
| `RATE_LIMIT_AUTH_READ_BURST` | `180` |
| `RATE_LIMIT_AUTH_WRITE_PER_MINUTE` | `240` |
| `RATE_LIMIT_AUTH_WRITE_BURST` | `60` |
| `RATE_LIMIT_HEAVY_READ_PER_MINUTE` | `300` |
| `RATE_LIMIT_HEAVY_READ_BURST` | `90` |

## Development and frontend values

These values do not change the standard production topology.

| Variable | Default | Scope |
|---|---|---|
| `DEV_API_PORT` | Automatically selected near `3001` | Host-run API port for `pnpm dev:stack`. |
| `DEV_WEB_PORT` | Automatically selected near `5173` | Vite development port. |
| `DEV_POSTGRES_PORT` | Automatically selected near `5432` | Development TimescaleDB host port. |
| `DEV_REDIS_PORT` | Automatically selected near `6379` | Development Redis host port. |
| `DEV_GARAGE_PORT` | Automatically selected near `3900` | Development Garage S3 API port. |
| `DEV_GARAGE_ADMIN_PORT` | Automatically selected near `3903` | Development Garage administration port. |
| `DEV_WEB_ORIGINS` | Active Vite origin | Development CORS origins. |
| `DEV_COMPOSE_PROJECT_NAME` | Checkout-derived | Development Compose isolation name. |
| `DEV_DATABASE_READY_TIMEOUT_SECONDS` | `600` | Maximum wait for TimescaleDB startup or crash recovery before `pnpm dev:stack` fails. Minimum `60`. |
| `COMPOSE_PROJECT_NAME` | Compose-derived | Optional general Compose project-name override. |
| `VITE_RIVIAMIGO_API_BASE_URL` | Current browser origin in production | Preferred frontend API base URL override. |
| `VITE_RIVIAMIGO_DEV_API_KEY` | Unset | Development-only integration key used by supported local tooling. |
| `VITE_RIVIAMIGO_RUN_LIVE_CONTRACT` | `0` | Enables explicitly requested live frontend contract tests. |
| `VITE_API_URL` | Unset | Legacy frontend API URL compatibility override. |
| `VITE_WS_URL` | Unset | Legacy frontend websocket URL compatibility override. |
