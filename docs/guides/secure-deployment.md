---
title: Secure deployment
description: Keep Riviamigo behind an authenticated HTTPS gateway and off the public origin port.
slug: /operations/secure-remote-access/
sidebar_label: Secure remote access
---

# Secure deployment

Use the [secure-deployment runbook](../runbooks/secure-deployment.md) as the
normative procedure and verification checklist. This page is only the short
operator route into that runbook.

## Required boundary

Riviamigo is not approved for direct Internet exposure. The production stack
binds its port `8080` origin to `127.0.0.1` by default. Put an authenticated
tunnel or identity-aware reverse proxy and host firewall rule in front of it; a
tunnel without an access policy is not enough.

Cloudflare Tunnel with Access and Authentik in front of Caddy, Nginx, or Traefik
are suitable deployment patterns. The gateway terminates public HTTPS and
requires identity before it forwards traffic to Riviamigo. Riviamigo login still
applies after the gateway.

## Required configuration

- Riviamigo defaults to production mode; set `RIVIAMIGO_ENV=development` only for local development.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS URL.
- Before the first production registration, configure one 32-byte-or-longer
  setup proof with `RIVIAMIGO_SETUP_TOKEN` or `RIVIAMIGO_SETUP_TOKEN_FILE`,
  then remove or rotate it after the owner is created.
- Let Riviamigo generate and persist its application keys in PostgreSQL, or
  supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` together
  through a secret manager. Partial overrides are rejected; preserve database
  backups or test the external secret-manager recovery path.
- Use strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values.
- Leave `COOKIE_INSECURE` unset.

### LAN-only HTTP exception

HTTPS behind the authenticated gateway remains the supported production shape.
For a trusted private network that cannot provide HTTPS, the Compose default
includes `ALLOW_INSECURE_LAN_HTTP_AUTH=false`. Change it to `true` only with
all of the following: `ALLOW_PUBLIC_ORIGIN_BIND=true`, a LAN-accessible bind,
and `ALLOWED_ORIGINS` containing only exact `http://` private, loopback, or
link-local **IP literals** (for example, `http://192.168.1.20:8080`).
Hostnames, public addresses, credentials, paths, and mixed HTTP/HTTPS origins
are rejected at startup. This removes only the cookie `Secure` attribute;
tokens remain HttpOnly, SameSite=Lax, rotated, and revocable. Anyone able to
observe that network can intercept browser credentials and telemetry, so use a
trusted wired/WPA-protected network and host firewall rules, and return to
HTTPS when possible.

## Network rules

- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 to the Internet. A non-loopback origin bind needs the
  explicit `ALLOW_PUBLIC_ORIGIN_BIND=true` opt-in and does not remove the
  gateway/firewall requirement.
- The gateway must support WebSocket upgrades and forward to
  `http://localhost:8080`. Riviamigo's live-status socket sends a lightweight
  application keepalive every 30 seconds; the gateway must pass those control
  frames and use an idle/read timeout comfortably above 90 seconds.
- Preserve `Host` and `Sec-WebSocket-Protocol` for the live-status socket. The
  latter carries the authenticated websocket subprotocol and must not be
  logged.
- Keep the gateway patched and apply its own Internet-facing rate limits.

Complete the repository's [secure-deployment runbook](../runbooks/secure-deployment.md)
before allowing access beyond the trusted host.
