# Prerequisites

Before deploying Riviamigo, make sure your environment meets the requirements below.

---

## Required

### Docker

- **Docker Engine 24+** — older versions may not support all Compose features used.
- **Docker Compose v2** — the CLI plugin version (`docker compose`, not `docker-compose`). Compose v2 ships with Docker Desktop and is available as a standalone plugin for Linux.

To verify:

```bash
docker --version          # Docker version 24.x or later
docker compose version    # Docker Compose version v2.x or later
```

### Server / Hardware

- A server, NAS, or VM capable of running Docker containers continuously.
- **~2 GB RAM minimum** for the full stack. **4 GB recommended** — TimescaleDB benefits significantly from additional memory for query performance and compression.
- **10–50 GB disk** depending on how long you retain raw telemetry. TimescaleDB compression is aggressive, but raw telemetry can accumulate over months of driving.

### Network / Gateway

Riviamigo is not approved for direct Internet exposure. Production Compose binds
its internal web origin only to `127.0.0.1:8080`; it does not publish the API,
database, or Redis service to the host.

Place an authenticated tunnel or identity-aware reverse proxy in front of that
origin. Examples include Cloudflare Tunnel with Access or Authentik in front of
Caddy, Nginx, or Traefik. A tunnel without an access policy is not sufficient.
Set `ALLOWED_ORIGINS` to the exact public HTTPS URL.

Outbound internet access is required for the Rivian WebSocket connection (`api.rivian.com`).

### Rivian Account

- A Rivian account with at least one registered vehicle.
- Access to the phone number or email linked to your Rivian account (for OTP during setup).
- You do **not** need a developer API key from Rivian — Riviamigo uses the same unofficial API that the Rivian mobile app uses.

---

## Optional

### Authenticated Gateway

An authenticated gateway is required for any shared deployment. It must:

- terminate public HTTPS and require an identity policy before forwarding;
- support WebSocket upgrades and forward traffic to `http://127.0.0.1:8080`;
- keep ports 3001, 5432, 6379, and 8080 unavailable from the public Internet.

Suitable gateway components include:

- **Caddy** — automatic HTTPS with minimal config.
- **Nginx Proxy Manager** — GUI-based management.
- **Traefik** — good for homelab Docker environments.

See [Secure Deployment](Secure-Deployment) for the full deployment contract.

### S3-Compatible Object Storage (for backups)

Riviamigo supports pushing database backups to any S3-compatible store. Options:

- **Garage** — included in `infra/docker-compose.yml` for local S3-compatible storage (development only).
- **MinIO** — self-hosted, production-grade.
- **Backblaze B2**, **Cloudflare R2**, **AWS S3** — any S3-compatible provider.

Configure with `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` in your `.env`.

### Grafana

If you want advanced dashboards or alerting beyond what Riviamigo's built-in UI provides, you can connect a Grafana instance to the Riviamigo API. See [Grafana Integration](Grafana-Integration).

> **Note:** The Grafana SimpleJSON endpoint is planned but returns 501 in the current release.
