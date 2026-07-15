# Deployment

This is the standard, self-hosted image deployment stack. For the shortest setup path, see [getting started](./getting-started.md).

The stack in [`compose/docker-compose.yml`](../../compose/docker-compose.yml) pulls published Riviamigo images and runs:

- TimescaleDB for application and telemetry data.
- Redis for session and token-lock state.
- The Riviamigo API on Docker's internal network.
- Nginx for the web app and API origin, bound to `127.0.0.1:8080` by default.

The loopback binding is intentional. Place an authenticated HTTPS tunnel or identity-aware reverse proxy in front of it; never publish the API, database, Redis, or origin port directly.

## Initial deployment

1. Copy `compose/.env.example` to `.env`, then prepare it using [configuration](./configuration.md). In particular, use `timescaledb` (not `localhost`) in `DATABASE_URL`, set separate strong database and Redis passwords, provide the signing and age encryption keys, and set `ALLOWED_ORIGINS` to your exact public HTTPS address. Standard Compose defaults to production mode.

2. Start the stack:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

3. Check that services are healthy:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml ps
   curl http://127.0.0.1:8080/health
   ```

4. Configure an authenticated gateway that forwards to `127.0.0.1:8080` and supports WebSockets. The [secure deployment guide](./secure-deployment.md) has the required access boundary.

5. Open the authenticated HTTPS address. The first account is the `super_user`; afterward, that owner can create activation links for invited users and optionally assign viewer access to a vehicle during the invitation flow.

## Logs and updates

```bash
# Follow every service
docker compose --env-file .env -f compose/docker-compose.yml logs -f

# Follow the API only
docker compose --env-file .env -f compose/docker-compose.yml logs -f api

# Pull a new image tag and recreate the stack
docker compose --env-file .env -f compose/docker-compose.yml pull
docker compose --env-file .env -f compose/docker-compose.yml up -d
```

The API applies its database migrations on startup. The first public release
uses one initial schema baseline; later releases add normal forward-only
migrations. Back up before a significant update and review the release notes
for breaking changes. Maintainers adopting the pre-release development database
must follow the [release database cutover](../runbooks/release-database-cutover.md)
before running the release build.

To pin a deployment, set `IMAGE_TAG` in `.env` to an exact Calendar Version such as `2026.07.0`, then run the same pull and up commands. `latest` remains the default and tracks the newest stable release.

## Build from source

Contributors and CI can build the same standard topology from the checked-out source without changing the image deployment file:

```bash
docker compose --env-file .env -f compose/docker-compose.yml -f compose/docker-compose.build.yml up -d --build
```

Local development uses `pnpm dev:stack` and `compose/docker-compose.dev.yml` instead; it is not the supported self-hosted deployment path.

## Stopping and recovery

```bash
# Stop containers but retain your data volumes
docker compose --env-file .env -f compose/docker-compose.yml down

# Destructive: remove containers and all stored data
docker compose --env-file .env -f compose/docker-compose.yml down -v --remove-orphans
```

For a database dump, restore process, and backup considerations, see [backup and restore](./backup-and-restore.md).
