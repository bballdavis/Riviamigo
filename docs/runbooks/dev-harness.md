# Riviamigo production-test clone and dev-upgrade harness

This runbook owns Riviamigo's portable, disposable production-package test. It
restores a verified Riviamigo `.rma.tar.gz` package into isolated test storage,
starts an immutable baseline image, and optionally upgrades only that clone to
an immutable development image.

Do not record a real account name, host name, LAN address, filesystem layout,
port, repository namespace, credential location, or historical release in this
file. Keep environment-specific values in host-local configuration or Komodo
variables.

## Invariants

- Production is never a restore target and is never modified by the harness.
- The test root, project, port, Compose file, and image references are explicit.
- The test project and root are clearly labelled as test-only.
- The production root and port are supplied only as safety boundaries; the test
  root and port must differ.
- Riviamigo images are immutable digest-qualified references. `latest` is rejected.
- Credentials and environment files remain host-local and outside source
  control, Forgejo, command arguments, and logs.
- Rollback recreates disposable storage from the preserved package. It never
  runs an older image against an already-migrated test database.

## Preflight

Before executing the harness, verify:

1. The recovery package has a recorded SHA-256 and passes the recovery manifest,
   migration, schema, checksum, and compatibility checks.
2. Both application images are pinned by `tag@sha256` and their source commits
   are known.
3. The test root, project, port, network, Compose file, and env file cannot
   overlap the production deployment.
4. The test endpoint is private or protected by an authenticated gateway.
5. The remote `dev` SHA and image provenance are re-read immediately before an
   optional development upgrade.

## Harness command

Use environment-appropriate values; the angle-bracket values below are
placeholders, not defaults.

```bash
node scripts/dev-harness.mjs \
  --package <verified-package-path> \
  --sha256 <64-hex-package-sha256> \
  --baseline-image ghcr.io/bballdavis/riviamigo:<baseline-tag>@sha256:<baseline-digest> \
  --dev-image ghcr.io/bballdavis/riviamigo:<dev-tag>@sha256:<dev-digest> \
  --production-root <absolute-production-root> \
  --production-port <production-port> \
  --test-root <absolute-test-root> \
  --env-file <absolute-test-env-file> \
  --compose-file <absolute-test-compose-file> \
  --port <test-port> \
  --project <test-project> \
  --plan
```

Plan mode is the default. Review its package checksum, archive members, image
digests, target paths, ports, and phases before adding `--execute`. Use
`--reset-test-storage` only after confirming the resolved root is the disposable
test root.

For a Komodo Procedure, use `pnpm dev:harness:procedure` and supply the
`RIVIAMIGO_HARNESS_*` variables. The package or package directory, production
root and port, test root and port, env file, Compose file, project, and immutable
images are all required configuration. The procedure passes only non-secret
paths and provenance values; credentials remain in the host-local env file.

Create the private test GitOps repository as
`<forgejo-owner>/Riviamigo-prod-test` (or another clearly test-labelled
Riviamigo name). Its tracked files are the isolated Compose contract,
non-secret runtime settings, `deployment.lock`, and rollback instructions.

## Test stack requirements

The isolated Compose contract contains the unified Riviamigo app, TimescaleDB,
and Redis for current images. The Riviamigo restore agent runs as a one-off
restore command, not a long-lived service. The contract must use a test-only
internal network and storage, must not mount production data or secrets, and
must not include production ports, routes, Traefik labels, network names, or
mutable images.

If an older baseline requires development-mode HTTP cookies for a private test
origin, configure that only in the host-local test env file. Never publish the
origin or copy that setting into production.

```dotenv
RIVIAMIGO_BIND_ADDRESS=0.0.0.0
ALLOW_PUBLIC_ORIGIN_BIND=true
ALLOW_INSECURE_LAN_HTTP_AUTH=true
ALLOWED_ORIGINS=http://<private-test-host>:<test-port>
RIVIAMIGO_ENV=development
COOKIE_INSECURE=true
```

## Ordered operation

1. Generate and inspect the plan.
2. Create or reset only the resolved disposable data directories.
3. Stage a read-only package copy and restore it with the baseline image.
4. Verify users, dashboards, telemetry, vehicles, trips, charging history,
   artwork, setup state, and health in the clone.
5. Update only the test lock to the immutable development digest and deploy only
   the test project through Komodo.
6. Record source and Compose SHAs, image digests, migration transition, health,
   and Komodo revision.
7. Restart the test deployment and verify persistence.
8. Re-read production and prove its revision, containers, route, port, network,
   and storage are unchanged.

## Rollback

Stop only the test deployment, preserve failed test state when diagnosis is
needed, recreate fresh disposable storage, restore the preserved package with
the prior immutable image, and redeploy the prior test lock. Production is never
part of rollback.

## Acceptance evidence

- The test application and dependencies are healthy.
- Only the configured test port is published.
- Rendered Compose contains no mutable image or production path, port, network,
  route, or proxy label.
- Restored data is present; provider credentials and live sessions remain absent
  until deliberately reauthenticated.
- Development migrations affect only the clone.
- Restart preserves test data and generated application keys.
- Komodo and source-control read-back match the recorded lock.
- Production remains unchanged.
