---
title: Deployment and updates
description: Deploy, update, inspect, stop, and recover the standard Riviamigo stack.
slug: /operations/deployment-and-updates/
sidebar_label: Deployment and updates
---

# Deployment and updates

The standard self-hosted stack runs TimescaleDB, Redis, and one unified Riviamigo container containing the API, web app, nginx origin, and backup tools. Only the unified app is published to the host, on port `8080` by default. Set `RIVIAMIGO_HOST_BIND_ADDRESS` when a specific host interface is required.

Place an authenticated HTTPS tunnel or identity-aware reverse proxy in front of the app and restrict direct port `8080` access with your host firewall. Never publish the API listener, database, or Redis directly.

## Initial deployment

1. Copy `compose/.env.example` to `.env`. Set separate strong database and Redis passwords, your exact public HTTPS `ALLOWED_ORIGINS` value, and a one-time `RIVIAMIGO_SETUP_TOKEN` of at least 32 bytes.
2. Start the stack. The example uses Docker-managed volumes, so no host preparation script is required:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

3. Verify it:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml ps
   curl http://localhost:8080/health
   ```

4. Configure an authenticated gateway that forwards to port `8080` and supports WebSockets.
5. Open the HTTPS address and create the first owner account.

## Persistent files

New installations use Docker-managed volumes:

| Docker volume       | Container path | Contents                                           |
| ------------------- | -------------- | -------------------------------------------------- |
| `riviamigo-db`      | `/db`          | PostgreSQL data                                    |
| `riviamigo-redis`   | `/data`        | Redis append-only state                            |
| `riviamigo-backups` | `/backups`     | Downloadable recovery packages                     |
| `riviamigo-cache`   | `/data/cache`  | Application cache files, including vehicle artwork |

Do not delete Docker volumes during updates. Copy recovery packages off-host for disaster recovery. Existing installations that omit the four `*_SOURCE` variables continue using their existing `RIVIAMIGO_DATA_DIR` bind paths.

If an existing installation uses bind paths, preserve its `RIVIAMIGO_DATA_DIR`
and grant the application user write access to its backup and cache directories.
The app performs a writable-storage probe before starting and reports the exact
container path when the host ACL is insufficient.

## Synology DSM

Use the dedicated [Synology DSM installation guide](./synology.md). It uses the
same universal Compose file and Docker-managed volumes; no Synology-specific
Compose file or generator is required.

## Logs and updates

```bash
docker compose --env-file .env -f compose/docker-compose.yml logs -f
docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo
docker compose --env-file .env -f compose/docker-compose.yml pull
docker compose --env-file .env -f compose/docker-compose.yml up -d
```

The app applies immutable, forward-only database migrations on startup. Set
`RIVIAMIGO_IMAGE` to the digest-qualified reference in the release's
`images.lock` for an exact deployment, or pin `IMAGE_TAG` to a Calendar Version
for normal version-level stability. Existing pre-release installations must
complete the one-time explicit baseline
adoption in the [release database cutover runbook](../runbooks/release-database-cutover.md)
before starting the flattened public release; startup never edits migration
bookkeeping automatically.

The charge identity upgrade is health-first: the schema expansion completes
before the app binds, then the unified app container reports `/health` while a
resumable in-process worker backfills existing charge history in the
background. A healthy response does not mean that every vehicle's backfill is
complete. Monitor the structured `charge_payload_identity_backfill_started`,
`charge_payload_identity_backfill_progress`,
`charge_payload_identity_backfill_complete`, and
`charge_payload_identity_backfill_failed` events before declaring a populated
upgrade finished. The PostgreSQL
`riviamigo.charge_payload_identity_backfill_status` row is the durable
checkpoint; a restart resumes rows whose `payload_fingerprint` is still null.
The later charge-identity helper migration only installs the canonical
fingerprint and identity-key functions used by ingestion, backfill, and
compaction; it does not start another backfill. Do not add a second backfill
container.

Before an upgrade, verify a recovery package and a raw `pg_dump`. If rollback
is required after the migration ledger advances, restore that pre-upgrade dump
using the previous image; reverting the image alone is not a safe rollback.

The PostgreSQL 18 image cannot reuse a PostgreSQL 16 data directory. Before upgrading an existing PostgreSQL 16 installation, create and verify a recovery package plus a raw `pg_dump`, stop the old stack, move its data directory aside, and restore into a newly initialized PostgreSQL 18 volume. Never point PostgreSQL 18 at the former PG16 directory. Follow the [backup and restore runbook](../runbooks/backup-restore.md) for the validation sequence.

Redis 8 can read the tested Redis 7 append-only snapshot format. Preserve a copy of `data/redis` before the upgrade. If Redis rejects the snapshot, start with an empty Redis directory; users will need to sign in again and external providers may need to reconnect, but PostgreSQL telemetry and configuration remain intact.

## Build from source

```bash
docker compose --env-file .env -f compose/docker-compose.yml -f compose/docker-compose.build.yml up -d --build
```

Local development continues to use `pnpm dev:stack` and
`compose/docker-compose.dev.yml`; production image consolidation does not
change that workflow. Extended Parallax acquisition is enabled inside the API
by default. Set `PARALLAX_ENABLED=false` only for emergency rollback; production
and development no longer launch a separate collector process or container.

## Stopping and recovery

```bash
docker compose --env-file .env -f compose/docker-compose.yml down
```

`down` retains Docker-managed volumes and existing bind-mounted application
data. Do not add `--volumes` during a routine stop or update. See
[backup and restore](./backup-and-restore.md) before replacing or deleting any
persistent storage.
