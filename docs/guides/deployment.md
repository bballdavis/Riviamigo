---
title: Deployment and updates
description: Deploy, update, inspect, stop, and recover the standard Riviamigo stack.
slug: /operations/deployment-and-updates/
sidebar_label: Deployment and updates
---

# Deployment and updates

The standard self-hosted stack runs TimescaleDB, Redis, and one unified Riviamigo container containing the API, web app, nginx origin, and backup tools. Only the unified app is bound to the host, on port `8080` by default.

Place an authenticated HTTPS tunnel or identity-aware reverse proxy in front of the app and restrict direct port `8080` access with your host firewall. Never publish the API listener, database, or Redis directly.

## Initial deployment

1. Copy `compose/.env.example` to `.env`. Set separate strong database and Redis passwords plus your exact public HTTPS `ALLOWED_ORIGINS` value. Internal service URLs and persistent application keys are generated automatically.
2. Start the stack:

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

The standard stack keeps operator-visible files under `./data`:

| Host directory | Container path | Contents                                           |
| -------------- | -------------- | -------------------------------------------------- |
| `data/db`      | `/db`          | PostgreSQL data                                    |
| `data/redis`   | `/data`        | Redis append-only state                            |
| `data/backups` | `/backups`     | Downloadable recovery packages                     |
| `data/cache`   | `/data/cache`  | Application cache files, including vehicle artwork |

Do not delete `data` during updates. Copy recovery packages off-host for disaster recovery.

## Logs and updates

```bash
docker compose --env-file .env -f compose/docker-compose.yml logs -f
docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo
docker compose --env-file .env -f compose/docker-compose.yml pull
docker compose --env-file .env -f compose/docker-compose.yml up -d
```

The app applies database migrations on startup. Pin `IMAGE_TAG` to an exact Calendar Version for repeatable deployments.

The PostgreSQL 18 image cannot reuse a PostgreSQL 16 data directory. Before upgrading an existing PostgreSQL 16 installation, create and verify a recovery package plus a raw `pg_dump`, stop the old stack, move its data directory aside, and restore into a newly initialized PostgreSQL 18 volume. Never point PostgreSQL 18 at the former PG16 directory. Follow the [backup and restore runbook](../runbooks/backup-restore.md) for the validation sequence.

Redis 8 can read the tested Redis 7 append-only snapshot format. Preserve a copy of `data/redis` before the upgrade. If Redis rejects the snapshot, start with an empty Redis directory; users will need to sign in again and external providers may need to reconnect, but PostgreSQL telemetry and configuration remain intact.

## Build from source

```bash
docker compose --env-file .env -f compose/docker-compose.yml -f compose/docker-compose.build.yml up -d --build
```

Local development continues to use `pnpm dev:stack` and `compose/docker-compose.dev.yml`; production image consolidation does not change that workflow.

## Upgrade from the former named volumes

Before the first start with the host-visible layout, stop the old stack and create a current recovery package. Then migrate the old volumes:

```bash
docker compose --env-file .env -f compose/docker-compose.yml down
node scripts/migrate-production-storage.mjs --project riviamigo
docker compose --env-file .env -f compose/docker-compose.yml up -d
```

The migration refuses running source volumes and non-empty destinations, verifies copied file counts, and retains the old volumes for rollback. Pass the prior Compose project name through `--project` if it was not `riviamigo`.

## Stopping and recovery

```bash
docker compose --env-file .env -f compose/docker-compose.yml down
```

`down` retains `./data`. Removing the containers does not remove bind-mounted application data. See [backup and restore](./backup-and-restore.md) before replacing or deleting the data directory.
