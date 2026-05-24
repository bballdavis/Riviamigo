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

### Network / Ports

The default configuration exposes:

| Port | Service |
|------|---------|
| 3000 | Web frontend (Nginx) |
| 3001 | Rust API |

Both ports must be available on the host, or you must run a reverse proxy (Nginx, Caddy, Traefik) and adjust `ALLOWED_ORIGINS` accordingly.

Outbound internet access is required for the Rivian WebSocket connection (`api.rivian.com`).

### Rivian Account

- A Rivian account with at least one registered vehicle.
- Access to the phone number or email linked to your Rivian account (for OTP during setup).
- You do **not** need a developer API key from Rivian — Riviamigo uses the same unofficial API that the Rivian mobile app uses.

---

## Optional

### Reverse Proxy

If you want HTTPS or a custom domain, place a reverse proxy in front of the stack:

- **Caddy** — automatic HTTPS with minimal config.
- **Nginx Proxy Manager** — GUI-based management.
- **Traefik** — good for homelab Docker environments.

Set `ALLOWED_ORIGINS` in your `.env` to match the public URL you'll be using.

### S3-Compatible Object Storage (for backups)

Riviamigo supports pushing database backups to any S3-compatible store. Options:

- **Garage** — included in `infra/docker-compose.yml` for local S3-compatible storage (development only).
- **MinIO** — self-hosted, production-grade.
- **Backblaze B2**, **Cloudflare R2**, **AWS S3** — any S3-compatible provider.

Configure with `S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` in your `.env`.

### Grafana

If you want advanced dashboards or alerting beyond what Riviamigo's built-in UI provides, you can connect a Grafana instance to the Riviamigo API. See [Grafana Integration](Grafana-Integration).

> **Note:** The Grafana SimpleJSON endpoint is planned but returns 501 in the current release.
