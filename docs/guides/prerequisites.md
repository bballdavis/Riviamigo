---
title: Prerequisites
description: Confirm the host, Docker, storage, browser, and network requirements for Riviamigo.
slug: /getting-started/prerequisites/
---

# Prerequisites

Riviamigo runs as a small Docker Compose stack. A home server, NAS that supports Docker Compose, or always-on Linux machine is a good fit.

The release stack pins PostgreSQL 18.4 with TimescaleDB 2.28.3, Redis 8.8, and immutable multi-architecture image digests. Operators do not need to install Node.js, pnpm, or Rust when using the published images.

## What you need

- Git and Docker Engine with Docker Compose v2 (`docker compose`).
- Enough persistent storage for PostgreSQL/TimescaleDB and backups. Start with at least 20 GB and leave room for your history to grow.
- A modern browser and a Rivian account with a vehicle attached.
- If you want remote access: an authenticated HTTPS tunnel or identity-aware reverse proxy. Do not forward a public port directly to Riviamigo.

## Helpful, but optional

- A backup destination you control.
- A hostname for the authenticated gateway.
- A UPS for a home server or NAS.

The database and Redis remain inside the Compose network. The web origin publishes port 8080 by default, so host firewall and gateway configuration are part of a remote installation rather than an optional afterthought.

## Building from source

Contributors need Node.js 24.18.x, pnpm 11.15.1, Rust 1.97.1, Docker
Engine with Docker Compose v2, and `curl`. The repository pins the Node,
pnpm, and Rust versions in `package.json`, `rust-toolchain.toml`, and
`config/dependency-baselines.json`; use those files rather than a separately
remembered toolchain version.

### Windows Rust builds

The pinned Rust toolchain uses the Windows MSVC target. Windows contributors
must install Visual Studio 2017 or later, or Visual Studio Build Tools, with
the **Desktop development with C++** workload. That workload must include the
MSVC compiler/linker (`cl.exe` and `link.exe`) and a Windows 10 or Windows 11
SDK. VS Code alone is not sufficient.

Run Cargo from a Visual Studio Developer PowerShell or Developer Command
Prompt so the MSVC tools are available on `PATH`, then verify the toolchain
before starting the dev stack:

```powershell
where.exe cl.exe
where.exe link.exe
cd apps/api
cargo build
```

The `pnpm run dev:stack` launcher starts the Docker-backed development
services, builds the host-run Rust API, and uses `curl` for readiness checks.
