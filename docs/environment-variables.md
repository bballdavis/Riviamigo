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
| `ALLOWED_ORIGINS` | Yes | None in production | Comma-separated exact HTTPS browser origins. Paths, credentials, queries, fragments, and HTTP origins are rejected in production unless the explicit LAN-only exception below is enabled. |
| `POSTGRES_USER` | No | `riviamigo` | Database role used by production Compose. |
| `DATABASE_URL` | No | Built from `POSTGRES_USER` and `POSTGRES_PASSWORD` | Complete PostgreSQL URL. Overrides the standard Compose-derived URL and is required for direct API runs without `POSTGRES_PASSWORD`. |
| `REDIS_URL` | No | Built from `REDIS_PASSWORD` | Complete Redis URL using the Redis ACL `default` user. Overrides the standard Compose-derived URL and is required for direct API runs without `REDIS_PASSWORD`. |

## Image and Compose values

| Variable | Default | Purpose |
|---|---|---|
| `RIVIAMIGO_IMAGE_REGISTRY` | `ghcr.io/bballdavis` | Registry namespace containing the unified `riviamigo` image. |
| `IMAGE_TAG` | `latest` | Image tag; use a Calendar Version for repeatable deployments. |
| `RIVIAMIGO_ORIGIN_PORT` | `8080` | Host port mapped to the unified app container. Protect it with host firewall rules when using a remote gateway. |
| `RIVIAMIGO_HOST_BIND_ADDRESS` | `0.0.0.0` | Docker host-side address for the published origin port. This Compose-only setting is separate from the application's internal listener. Restrict it with a host firewall. |
| `RIVIAMIGO_BIND_ADDRESS` | `127.0.0.1` | Application listener address inside the container. It is not the Docker host publication address. |
| `ALLOW_PUBLIC_ORIGIN_BIND` | `false` | Required, with the literal value `true`, before a non-loopback application `RIVIAMIGO_BIND_ADDRESS` is accepted. This is an explicit exposure opt-in, not a substitute for the authenticated gateway and firewall. |
| `ALLOW_INSECURE_LAN_HTTP_AUTH` | `false` | **LAN-only exception.** With the literal value `true`, permits non-Secure refresh cookies only when `ALLOW_PUBLIC_ORIGIN_BIND=true`, the API binds to an unspecified/private/loopback/link-local IP, and every `ALLOWED_ORIGINS` entry is an exact `http://` private/loopback/link-local IP literal. It rejects hostnames, public IPs, HTTPS/HTTP mixes, paths, and credentials. Browser credentials and telemetry can be intercepted; prefer HTTPS. |
| `RIVIAMIGO_ENV_FILE` | `../.env` relative to `compose/docker-compose.yml` | Alternate dotenv file injected into the app container. The generated Synology file defaults to `.env.synology`; restore and verification scripts set this automatically. |

## Application security and runtime

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | Generated and stored in PostgreSQL | RSA private signing key. If overridden, the public and age keys must also be supplied. |
| `JWT_PUBLIC_KEY` | Generated and stored in PostgreSQL | RSA public verification key. Supply only as part of the complete three-key override. |
| `AGE_ENCRYPTION_KEY` | Generated and stored in PostgreSQL | age X25519 identity used to encrypt provider credentials. Supply only as part of the complete three-key override. |
| `RIVIAMIGO_SETUP_TOKEN` | Unset | One-time first-owner proof for production registration. Mutually exclusive with `RIVIAMIGO_SETUP_TOKEN_FILE`; must be at least 32 bytes. Keep this value out of shell history where possible. |
| `RIVIAMIGO_SETUP_TOKEN_FILE` | Unset | File containing the one-time first-owner proof. Mutually exclusive with `RIVIAMIGO_SETUP_TOKEN`; one trailing line ending is accepted. Prefer a mounted secret file. |
| `RIVIAMIGO_ENV` | `production` | Enables production configuration validation. Use `development` only for local development. |
| `PORT` | `3001` | Internal API listener port. The unified production nginx expects `3001`. |
| `RUST_LOG` | `riviamigo_api=debug,tower_http=info` | Rust tracing filter. Structured `[riviamigo][LEVEL]` key-value logs are written to stdout. |
| `TZ` | UTC | Docker/container timezone used by nginx and other runtime processes. This does not control Riviamigo’s user-facing application timezone, which is configured in Settings → Units. |
| `COOKIE_INSECURE` | Unset | Legacy local-development-only switch for non-Secure cookies. Any value enables it in development; production rejects it. Use `ALLOW_INSECURE_LAN_HTTP_AUTH=true` only for the documented LAN exception. |
| `VEHICLE_IMAGE_CACHE_DIR` | Platform cache directory; `/data/cache/riviamigo/vehicle-images` in the production image | Persistent local artwork mirror. Standard Compose does not need to set it. |
| `RIVIAMIGO_DATA_DIR` | `../data` relative to `compose/docker-compose.yml` | Overrides the host directory used for PostgreSQL, Redis, backups, and cache data. Primarily useful for isolated verification stacks. |
| `BACKUP_DRIVER` | `pg_dump` | Recovery-package database exporter. Other values are rejected for full recovery packages. |
| `BACKUP_ARTIFACT_DIR` | `/backups` | Directory containing generated, imported, safety, and restore-job recovery artifacts. Keep it on persistent storage with capacity for the uploaded package plus a required safety backup. |
| `BACKUP_POLL_INTERVAL_SECONDS` | `60` | Number of seconds between backup-scheduler checks. |
| `RESTORE_AGENT_URL` | `http://127.0.0.1:3002` | Internal unified-container restore supervisor URL. Do not expose it as a public service. |
| `RESTORE_AGENT_KEY_FILE` | `/backups/.restore-agent-key` | Internal capability key generated by the production entrypoint. Keep it inside the persistent backup volume. |
| `RECOVERY_MAX_UPLOAD_BYTES` | `17179869184` (16 GiB) | Largest accepted imported recovery package. |
| `RECOVERY_MAX_EXPANDED_BYTES` | `68719476736` (64 GiB) | Largest permitted expanded recovery archive. |
| `RECOVERY_MAX_MEMBER_BYTES` | `68719476736` (64 GiB) | Largest permitted individual archive member. Cannot exceed the expanded limit. |
| `RECOVERY_MAX_MEMBERS` | `10000` | Maximum archive-member count. |
| `RECOVERY_MAX_COMPRESSION_RATIO` | `200` | Maximum permitted expanded-to-compressed archive ratio. |
| `RECOVERY_MIN_FREE_BYTES` | `2147483648` (2 GiB) | Minimum free artifact-volume space before import/write steps. Values below 2 GiB are rejected. |
| `RECOVERY_UPLOAD_DEADLINE_SECONDS` | `1800` (30 min) | Deadline for receiving and validating an imported package. |
| `RECOVERY_RESTORE_DEADLINE_SECONDS` | `14400` (4 hr) | Deadline for the restore supervisor's destructive swap operation. |
| `S3_ENDPOINT` | Unset | Optional fallback endpoint when the saved S3 endpoint is empty. Custom endpoints use path-style addressing. |
| `S3_ACCESS_KEY` | Unset | Optional fallback access key used only when a complete saved credential pair is unavailable. |
| `S3_SECRET_KEY` | Unset | Optional fallback secret key paired with `S3_ACCESS_KEY`; never returned by the API or stored in recovery packages. |

The setup endpoint reports whether a proof is required and available, but never
reveals its source or value. An unclaimed production installation without a
configured proof remains healthy but refuses registration.

Generated application keys are part of the PostgreSQL backup and therefore
survive restore. This is an explicitly accepted **P2 shared-fate risk**: a
database compromise or loss can affect both application state and locally
generated keys. Operators who need separate key custody should supply all three
external overrides from their secret manager and maintain a tested recovery path
for that manager. Administrators can inspect the active source through
`GET /v1/admin/security/status`; startup logs expose only the source category,
never key material. Supplying a new explicit
age key to an existing database can make stored encrypted credentials unreadable;
treat key changes as a migration.

## Rivian telemetry behavior

| Variable | Default | Purpose |
|---|---|---|
| `RIVIAN_GRAPHQL_GATEWAY_URL` | Rivian production GraphQL gateway | Diagnostic upstream override. Normal installations should not set it. |
| `RIVIAN_WS_RECONNECT_INITIAL_SECONDS` | `10` | Initial websocket reconnect delay. |
| `RIVIAN_WS_RECONNECT_MAX_SECONDS` | `900` | Maximum websocket reconnect delay. |
| `RIVIAN_RAW_EVENT_RETENTION_DAYS` | `7` | Raw telemetry retention window in days. |
| `RIVIAN_PERSIST_RAW_EVENTS` | `true` | Persists raw Rivian events for diagnostics and repair. |
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
| `DEV_CARGO_BUILD_JOBS` | `4` on Windows; unused elsewhere | Maximum concurrent Cargo jobs while Windows `pnpm dev:stack` builds the API and restore supervisor. Set a positive integer to override. |
| `COMPOSE_PROJECT_NAME` | Compose-derived | Optional general Compose project-name override. |
| `VITE_RIVIAMIGO_API_BASE_URL` | Current browser origin in production | Preferred frontend API base URL override. |
| `VITE_RIVIAMIGO_DEV_API_KEY` | Unset | Development-only integration key used by supported local tooling. |
| `VITE_RIVIAMIGO_RUN_LIVE_CONTRACT` | `0` | Enables explicitly requested live frontend contract tests. |
| `VITE_API_URL` | Unset | Legacy frontend API URL compatibility override. |
| `VITE_WS_URL` | Unset | Legacy frontend websocket URL compatibility override. |
