# Secure Deployment Boundary

This is the normative secure-deployment procedure. The [secure deployment
guide](../guides/secure-deployment.md) is a short operator entry point and the
[security architecture](../security.md) records the product posture; neither
changes the requirements in this runbook.

## Supported exposure model

Riviamigo is not approved for direct Internet exposure. The standard production
Compose stack publishes its web origin on port `8080` using normal Docker host
publication; set `RIVIAMIGO_HOST_BIND_ADDRESS` to limit the host interface and
runs the long-lived app as UID/GID `1001`, with a read-only root filesystem,
all Linux capabilities dropped, `no-new-privileges`, and a bounded `/tmp`
tmpfs. Its one-shot initialization service is intentionally the only root
process. Do not weaken these defaults to make an origin public.

Place an authenticated tunnel or identity-aware reverse proxy and host firewall
rule in front of that origin. A tunnel that only publishes the port
without an access policy is not sufficient. A non-loopback bind requires both
`RIVIAMIGO_BIND_ADDRESS` and the explicit
`ALLOW_PUBLIC_ORIGIN_BIND=true` opt-in; it remains unsupported as a direct
Internet exposure pattern.

The outer gateway must terminate public HTTPS, require an identity policy, and
forward normal HTTP and WebSocket traffic to `http://localhost:8080`. Riviamigo
login remains enabled behind that gateway. Cloudflare Tunnel with Access and
Authentik in front of Caddy, Nginx, or Traefik are supported deployment shapes;
the gateway itself is operated and patched by the self-hoster.

## Required production configuration

- Riviamigo defaults to production mode; use `RIVIAMIGO_ENV=development` only for local development.
- Configure a 32-byte-or-longer production first-owner proof through exactly
  one of `RIVIAMIGO_SETUP_TOKEN` or `RIVIAMIGO_SETUP_TOKEN_FILE`. The setup
  endpoint reports availability but never reveals which source is used. Before
  a user exists, registration fails closed without a valid proof; after the
  first owner claims the instance, remove or rotate the bootstrap proof.
- Let Riviamigo generate and persist its application keys in PostgreSQL, or
  supply `JWT_SECRET`, `JWT_PUBLIC_KEY`, and `AGE_ENCRYPTION_KEY` together from
  a secret manager. Partial overrides fail startup. Database-persisted keys are
  an explicitly accepted P2 shared-fate risk; preserve PostgreSQL backups and,
  for externally managed keys, document and test the secret-manager recovery
  path.
- Set `ALLOWED_ORIGINS` to the exact public HTTPS origin, with no path.
- Set strong `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values. Standard Compose
  safely constructs its internal URLs; custom `DATABASE_URL` values must be valid URLs.
- Keep `COOKIE_INSECURE` absent. It is local-development-only.
- Do not publish API port 3001, PostgreSQL port 5432, Redis port 6379, or the
  origin port 8080 directly to the Internet.

### Exceptional trusted-LAN HTTP access

Do not use this procedure for public, guest, or untrusted Wi-Fi networks. If
HTTPS cannot be provided on an isolated trusted LAN, set all of these in the
Compose environment file:

```dotenv
RIVIAMIGO_BIND_ADDRESS=0.0.0.0
ALLOW_PUBLIC_ORIGIN_BIND=true
ALLOWED_ORIGINS=http://192.168.1.20:8080
ALLOW_INSECURE_LAN_HTTP_AUTH=true
```

The final variable is a strict boolean and defaults to `false` in the standard
Compose file. Startup accepts only private, loopback, or link-local literal IP
HTTP origins; it rejects hostnames, public IPs, paths, credentials, and mixed
HTTP/HTTPS origin lists. This is an intentional reduction in transport
protection: refresh cookies remain HttpOnly, SameSite=Lax, rotating, and
revocable, but they no longer carry the `Secure` attribute. Restrict the port
to the trusted LAN with host firewall rules, disclose the interception risk to
users, and restore HTTPS as soon as possible.

## Gateway requirements

- Enforce authentication before forwarding any request, including `/v1/*` and
  WebSocket upgrades.
- Preserve `Host` and WebSocket upgrade headers. Do not log `Authorization` or
  `Sec-WebSocket-Protocol` headers.
- Preserve live-status control frames and configure the gateway's websocket
  idle/read timeout above 90 seconds. Riviamigo sends a keepalive every 30
  seconds and the browser reconnects when it misses the 90-second liveness
  window.
- Own public TLS, certificate renewal, Internet-facing rate limits, and any
  trusted-client-IP policy. The internal Riviamigo origin intentionally does
  not trust arbitrary forwarded client IP headers.
- Restrict direct host access to port 8080 with host firewall rules.

## Verification

1. Run `docker compose --env-file .env -f compose/docker-compose.yml config`
   and confirm the unified app publishes the intentionally selected
   `RIVIAMIGO_HOST_BIND_ADDRESS` and `RIVIAMIGO_ORIGIN_PORT` values, with no
   database or Redis port.
2. Start the stack and check `curl http://localhost:8080/health` locally.
3. Confirm external access is denied by the gateway before reaching Riviamigo,
   then authenticate through the gateway and sign in to Riviamigo.
4. Confirm `docker compose --env-file .env -f compose/docker-compose.yml ps` shows no host
   mapping for the internal API listener, TimescaleDB, or Redis.
5. Run `pnpm docs:check` and the security test suite before upgrading a shared
   instance.
6. From the public address, leave a signed-in dashboard open beyond the
   gateway idle window, background and refocus the tab, and confirm the status
   transitions through `Reconnecting...` to `Online` without a page reload.
7. Confirm `docker compose ... config` retains `user: "1001:1001"`,
   `read_only: true`, `cap_drop: [ALL]`, and `no-new-privileges:true` for the
   long-lived `riviamigo` service. These are deployment controls, not optional
   tuning.

## Limits of this guidance

This boundary reduces exposure; it is not a security certification or a
substitute for gateway patching, host hardening, backups, monitoring, and an
independent penetration test when the deployment risk warrants one.
