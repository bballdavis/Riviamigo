# Prerequisites

Riviamigo runs as a small Docker Compose stack. A home server, NAS that supports Docker Compose, or always-on Linux machine is a good fit.

## What you need

- Git and Docker Engine with Docker Compose v2 (`docker compose`).
- Enough persistent storage for PostgreSQL/TimescaleDB and backups. Start with at least 20 GB and leave room for your history to grow.
- A modern browser and a Rivian account with a vehicle attached.
- If you want remote access: an authenticated HTTPS tunnel or identity-aware reverse proxy. Do not forward a public port directly to Riviamigo.

## Helpful, but optional

- A backup destination you control.
- A hostname for the authenticated gateway.
- A UPS for a home server or NAS.

The database and Redis remain inside the Compose network. The web origin binds to the host loopback interface by default, so gateway configuration is part of a remote installation rather than an optional afterthought.
