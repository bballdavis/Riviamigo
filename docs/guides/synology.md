---
title: Install Riviamigo on Synology DSM
description: Deploy Riviamigo through Synology Container Manager and DSM Reverse Proxy.
slug: /getting-started/synology/
sidebar_label: Synology DSM
---

# Install Riviamigo on Synology DSM

Synology uses the same conservative Docker Compose deployment as every other
Docker host. There is no Synology-specific Compose file, generator, Node.js
runtime, repository clone, or executable host script.

## Requirements

- DSM with Synology Container Manager and Docker Compose project support.
- At least 4 GB RAM available to the stack and at least 20 GB persistent storage.
- An HTTPS hostname and certificate configured in DSM Reverse Proxy.
- A recovery package or PostgreSQL dump before upgrading an existing install.

## Create the project

1. Download `docker-compose.yml` and `example.env` from the matching Riviamigo
   release. Rename `example.env` to `.env`.
2. Put both files in one DSM project folder, such as
   `/volume1/docker/riviamigo`.
3. Edit `.env` with strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values,
   your HTTPS `ALLOWED_ORIGINS`, and a random `RIVIAMIGO_SETUP_TOKEN` of at
   least 32 bytes.
4. In Container Manager, create a Project from that folder and select the
   downloaded `docker-compose.yml`.
5. Set the project environment value `RIVIAMIGO_ENV_FILE=.env`, because the
   universal file keeps the repository-root default `../.env` for existing
   checkouts.
6. Build and start the project. Wait for `timescaledb`, `redis`, and
   `riviamigo` to become healthy.

The example environment selects Docker-managed volumes for the database, Redis,
backups, and cache. Container Manager therefore does not need ACL access to a
shared-folder bind path for a new install.

For an existing installation, keep its current `RIVIAMIGO_DATA_DIR` bind path
and omit the four `*_SOURCE` variables. Do not delete that data directory.
The app checks `/backups` and `/data/cache` as UID 1001 before starting and
reports a clear permission error if DSM ACLs do not grant write access.

## DSM Reverse Proxy

Create an HTTPS reverse-proxy rule with this topology:

```text
Source:      HTTPS riviamigo.example.net:443
Destination: HTTP 127.0.0.1:8080
```

Enable WebSocket forwarding, preserve the `Host` header, and allow an idle/read
timeout comfortably above 90 seconds. Keep `ALLOWED_ORIGINS` equal to the
public HTTPS origin.

If the reverse proxy is on another machine, set an explicit,
firewall-restricted `RIVIAMIGO_HOST_BIND_ADDRESS` and review the
[secure-deployment runbook](../runbooks/secure-deployment.md).

## Verification and updates

From the NAS, check the project and loopback origin:

```bash
docker compose --env-file .env -f docker-compose.yml ps
curl http://127.0.0.1:8080/health
```

Open the HTTPS hostname and create the first owner account with the configured
instance setup token. After the owner is created, remove the token from the
environment file and recreate the app; never delete the database volume.

For updates, verify a recovery package, pull the new image, and recreate the
same project:

```bash
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d
docker compose --env-file .env -f docker-compose.yml ps
```

The database and Redis health checks allow slow first initialization, and the
app applies forward-only migrations before reporting healthy. Do not add CPU or
PID limits to the project; apply host resource policy through DSM if needed.

## Troubleshooting

- **Database dependency is still starting:** wait for the first TimescaleDB
  initialization to finish; the Compose health check allows several minutes.
- **Permission denied for `/backups` or `/data/cache`:** this is an existing
  bind-mount installation. Grant the container user write access to those DSM
  folders, or migrate to Docker-managed volumes; do not use `chmod 777`.
- **First-owner registration returns `SETUP_PROOF_REQUIRED`:** set
  `RIVIAMIGO_SETUP_TOKEN` in `.env` and recreate the app without deleting its
  database.
- **The setup token is rejected:** re-enter the exact configured value. The
  token is never placed in URLs, logs, or browser storage.
- **DSM Reverse Proxy returns 502:** verify that `riviamigo` is healthy and
  that the destination is `127.0.0.1:8080`.
- **Login does not survive refresh:** verify HTTPS, the exact
  `ALLOWED_ORIGINS` value, and cookie forwarding through the proxy.

For the Rivian connection flow, see [Connect your Rivian account](./rivian-account.md).
