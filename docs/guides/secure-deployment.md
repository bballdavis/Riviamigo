---
title: Secure deployment
description: Keep Riviamigo behind an authenticated HTTPS gateway and off the public origin port.
slug: /getting-started/secure-deployment/
---

# Secure deployment

## Required boundary

Riviamigo is not approved for direct Internet exposure. The production stack
publishes only a loopback origin at `127.0.0.1:8080`. Put an authenticated
tunnel or identity-aware reverse proxy in front of it; a tunnel without an
access policy is not enough.

Cloudflare Tunnel with Access and Authentik in front of Caddy, Nginx, or Traefik
are suitable deployment patterns. The gateway terminates public HTTPS and
requires identity before it forwards traffic to Riviamigo. Riviamigo login still
applies after the gateway.

## Required configuration

- The standard Compose stack defaults to `RIVIAMIGO_ENV=production`; do not override it for a shared deployment.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS URL.
- Supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` through a
  secret manager or protected deployment environment. Production startup fails
  if any are absent.
- Use strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values.
- Leave `COOKIE_INSECURE` unset.

## Network rules

- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 to the Internet.
- The gateway must support WebSocket upgrades and forward to
  `http://127.0.0.1:8080`.
- Keep the gateway patched and apply its own Internet-facing rate limits.

For the maintainer verification checklist, see the repository's
[secure-deployment runbook](../runbooks/secure-deployment.md).
