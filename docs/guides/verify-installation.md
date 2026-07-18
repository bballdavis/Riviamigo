---
title: Verify the installation
description: Confirm container health, application access, ownership, and initial Rivian telemetry.
slug: /getting-started/verify-installation/
sidebar_label: Verify the installation
---

# Verify the installation

Verify the runtime before exposing it through a gateway or treating the installation as recoverable. Complete these checks after the first start and after significant deployment changes.

## Check container health

From the repository root, inspect the production stack:

```bash
docker compose --env-file .env -f compose/docker-compose.yml ps
```

The unified app, database, and Redis services should be running, and services with health checks should become healthy. If a service is restarting or unhealthy, inspect its recent logs before changing configuration:

```bash
docker compose --env-file .env -f compose/docker-compose.yml logs --tail=200
```

For one service, append its Compose service name to the logs command.

## Check the private origin

Open `http://localhost:8080` from the host. The login or first-owner setup screen should load; use a host firewall and authenticated gateway before exposing it remotely.

If the page does not load:

1. Confirm the web and API services are healthy.
2. Confirm another process is not occupying the configured origin port.
3. Review the web and API logs.
4. Recheck required values in [Configuration](./configuration.md).

## Create and confirm the first owner

The first completed account setup becomes the installation owner. After signing in:

- Confirm the session survives a normal page refresh.
- Open Settings and confirm owner-only administration surfaces are available.
- Do not create additional users until the first owner and access boundary are verified.

## Confirm Rivian connectivity

Follow [Rivian account setup](./rivian-account.md), then confirm:

- The connected vehicle appears in the vehicle selector.
- Current vehicle status eventually appears after Rivian authentication succeeds.
- Sleeping vehicles are allowed time to report; missing immediate telemetry is not automatically an installation failure.
- Persistent authentication or MFA errors are handled through the Rivian connection flow rather than by repeatedly restarting the entire stack.

## Verify the gateway before remote use

After local verification, configure the authenticated HTTPS gateway described in [Secure deployment](./secure-deployment.md). From the final public address, confirm:

- HTTPS is valid.
- Authentication is required before Riviamigo is reachable.
- Normal API requests succeed after sign-in.
- Live vehicle updates do not show WebSocket connection failures.
- Host firewall rules and the authenticated gateway protect port 8080 from direct public access.

## Establish a recovery baseline

Once the installation is healthy and connected, follow [Backup and restore](./backup-and-restore.md) to create and verify the first recovery package. A running dashboard without a tested recovery package is not a complete installation.
