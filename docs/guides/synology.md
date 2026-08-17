---
title: Install Riviamigo on Synology DSM
description: Deploy Riviamigo through Synology Container Manager and DSM Reverse Proxy.
slug: /getting-started/synology/
sidebar_label: Synology DSM
---

# Install Riviamigo on Synology DSM

This guide uses the standalone Synology Compose file. It keeps the same
Riviamigo image, database, Redis, health checks, persistent volumes, and
security controls as the standard deployment, while avoiding CPU quota fields
that some DSM kernels reject.

## Requirements

- DSM with Synology Container Manager and Docker Compose project support.
- At least 4 GB RAM available to the stack and at least 20 GB of persistent
  storage, with additional space for telemetry history and backups.
- An HTTPS hostname and certificate configured in DSM Reverse Proxy.
- A recovery package or PostgreSQL dump before upgrading an existing install.

If your DSM release cannot run the pinned PostgreSQL and Redis images, use a
supported Docker host instead of changing the application images in this file.

## Choose a storage path

Use a shared-folder path on the volume with sufficient capacity, for example:

```text
/volume1/docker/riviamigo/data
/volume2/docker/riviamigo/data
```

These are examples, not hardcoded requirements. The path must be absolute and
must remain stable when the Container Manager project is recreated.

## Prepare directories

The stack needs `db`, `redis`, `backups`, and `cache` under the selected data
directory. If SSH is enabled, run this from the repository checkout:

```bash
export RIVIAMIGO_DATA_DIR=/volume1/docker/riviamigo/data
sudo -E ./compose/prepare-data.sh
```

The script is repeatable, prints each final directory, and checks that each
directory is writable. It does not change DSM ACLs or ownership automatically.

Without SSH, create the shared folder and these four subfolders in DSM File
Station. In Container Manager, grant the project’s container service read/write
access to the shared folder. If the prepare script reports a permissions error,
fix the shared-folder ACL in DSM rather than weakening the Compose security
settings.

## Environment configuration

Copy `compose/.env.synology.example` to `compose/.env.synology` and replace the
database password, Redis password, and HTTPS origin. Set
`RIVIAMIGO_DATA_DIR` to the actual absolute DSM path. Keep
`ALLOW_INSECURE_LAN_HTTP_AUTH=false`; the supported path uses HTTPS through DSM
Reverse Proxy.

Do not commit the resulting env file. The generated Compose file defaults to
`.env.synology` and does not require editing.

## Create the Container Manager project

1. Clone or download the repository on the NAS, or copy the `compose` directory
   and generated file to a NAS project folder.
2. Generate or verify the standalone file from the repository root:

   ```bash
   pnpm compose:synology:generate
   pnpm compose:synology:check
   ```

   If Node.js and pnpm are not installed on DSM, use the checked-in generated
   file from the release artifact and do not edit it.
3. In Container Manager, create a Project from an existing Compose file and
   select `compose/docker-compose.synology.yml` as the single Compose file.
4. Set the project environment file to `compose/.env.synology` if the UI does
   not use the generated default automatically.
5. Start the project and wait until `timescaledb`, `redis`, and `riviamigo` are
   healthy. The one-shot `riviamigo-init` service should complete successfully.

The Synology file is standalone. Do not combine it with the standard file or
remove the generated loopback port mapping.

## Complete Synology Compose file

The documentation site embeds the generated deployment file directly from the
repository:

```compose-include
compose/docker-compose.synology.yml
```

## DSM Reverse Proxy

Create an HTTPS reverse-proxy rule in DSM with this topology:

```text
Source:
  Protocol: HTTPS
  Hostname: riviamigo.example.net
  Port: 443

Destination:
  Protocol: HTTP
  Hostname: 127.0.0.1
  Port: 8080
```

Enable WebSocket forwarding for the rule. Preserve the `Host` header and allow
an idle/read timeout comfortably above 90 seconds so live vehicle status can
send its keepalive frames. Riviamigo authentication remains enabled behind
the proxy.

If the reverse proxy runs on another machine, do not silently expose the NAS
port. Choose an explicit, firewall-restricted host publication address and
review the transport and `ALLOWED_ORIGINS` requirements in the
[secure-deployment runbook](../runbooks/secure-deployment.md).

## Verification

From the NAS, check the loopback origin:

```bash
curl http://127.0.0.1:8080/health
docker compose --env-file compose/.env.synology -f compose/docker-compose.synology.yml ps
```

The health endpoint should return success, and the database, Redis, and app
services should be healthy. The web UI should load through the HTTPS hostname.

When connecting a Rivian, a successful OTP submission saves the vehicle and
reports telemetry as `starting` while the worker begins. The vehicle should
not require a container restart before its first poll. Worker failures remain
visible in the vehicle status and logs.

## Updates and backups

Back up the recovery package and verify it before upgrading. Then pull the new
image and recreate the project with the same env file and absolute data path:

```bash
docker compose --env-file compose/.env.synology -f compose/docker-compose.synology.yml pull
docker compose --env-file compose/.env.synology -f compose/docker-compose.synology.yml up -d
docker compose --env-file compose/.env.synology -f compose/docker-compose.synology.yml ps
```

Startup applies forward-only migrations. The charge identity schema expansion
must finish before the unified app binds; after `/health` succeeds, its
resumable in-process worker may continue backfilling existing charge history
in the background. Confirm the app is healthy, then inspect the structured app
log events named `charge_payload_identity_backfill_started`,
`charge_payload_identity_backfill_progress`,
`charge_payload_identity_backfill_complete`, or
`charge_payload_identity_backfill_failed` before treating a populated upgrade
as complete. Never add a second migration/backfill container or remove the
data directory during an update.

Before updating, verify a recovery package and a raw `pg_dump`. If rollback is
needed after the migration ledger advances, restore that pre-upgrade dump with
the previous image; reverting only the image is not a safe rollback.

## Troubleshooting

- **`NanoCPUs can not be set`:** confirm Container Manager is using
  `docker-compose.synology.yml`, not the standard file or an old override. The
  generated Synology file contains no `cpus`, `cpu_period`, or `cpu_quota`
  fields.
- **Bind source path does not exist:** set an absolute `RIVIAMIGO_DATA_DIR`,
  create the four subdirectories, and recreate the project.
- **Permission denied for `/db` or Redis `/data`:** grant Container Manager
  read/write access to the selected shared folder in DSM; do not delete data or
  weaken the container user settings.
- **DSM Reverse Proxy returns 502:** verify that the project is healthy, that
  the destination is `127.0.0.1:8080`, and that the configured origin port
  matches `RIVIAMIGO_ORIGIN_PORT`.
- **WebSocket disconnects:** enable WebSocket forwarding and increase the
  proxy idle/read timeout above 90 seconds.
- **Login does not survive refresh:** verify the HTTPS hostname is an exact
  `ALLOWED_ORIGINS` entry, the browser is using HTTPS, and the proxy preserves
  cookies. Do not enable insecure LAN auth as a workaround for a proxy error.
- **Vehicle saved but telemetry remains `starting`:** inspect the app logs and
  worker status; a saved vehicle and a delayed worker are separate outcomes.
  Restarting the container should not be the first fix.
- **Continuous disk activity:** inspect PostgreSQL and Redis separately, then
  review the charging-sync counters and run the charge-payload diagnostic in
  the [charge-payload cleanup runbook](../runbooks/charge-payload-cleanup.md).
  Normal database checkpoint activity is different from repeated unchanged
  charging-history writes.

For the Rivian connection flow, see [Connect your Rivian account](./rivian-account.md).
