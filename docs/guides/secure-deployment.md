---
title: Secure deployment
description: Keep Riviamigo behind an authenticated HTTPS gateway and off the public origin port.
slug: /operations/secure-remote-access/
sidebar_label: Secure remote access
---

# Secure deployment

## Required boundary

Riviamigo is not approved for direct Internet exposure. The production stack
publishes port `8080`. Put an authenticated tunnel or identity-aware reverse
proxy and host firewall rule in front of it; a tunnel without an
access policy is not enough.

Cloudflare Tunnel with Access and Authentik in front of Caddy, Nginx, or Traefik
are suitable deployment patterns. The gateway terminates public HTTPS and
requires identity before it forwards traffic to Riviamigo. Riviamigo login still
applies after the gateway.

## Required configuration

- Riviamigo defaults to production mode; set `RIVIAMIGO_ENV=development` only for local development.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS URL.
- Let Riviamigo generate and persist its application keys in PostgreSQL, or
  supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` together
  through a secret manager. Partial overrides are rejected.
- Use strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values.
- Leave `COOKIE_INSECURE` unset.

## Network rules

- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 to the Internet.
- The gateway must support WebSocket upgrades and forward to
  `http://localhost:8080`.
- Keep the gateway patched and apply its own Internet-facing rate limits.

For the maintainer verification checklist, see the repository's
[secure-deployment runbook](../runbooks/secure-deployment.md).
