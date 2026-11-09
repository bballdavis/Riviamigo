# Shareable Release Security Audit

## Status

This is an internal source and deployment-configuration audit for the shareable
release. It is not an independent penetration test or a security certification.
The release posture remains: do not expose Riviamigo directly to the Internet.

## Reviewed evidence

- Authentication: RS256 access-token validation pins issuer and zero leeway;
  access tokens remain in memory and refresh tokens are HttpOnly cookies.
- Authorization: API-key hashing, expiry, revocation, access-level checks, and
  dashboard ownership checks were reviewed at their shared middleware/route
  seams.
- Vehicle roles: viewers are read-only; managers may perform operational
  schedule and history-backfill actions; owners retain credential and
  membership administration.
- Data handling: SQL access in the reviewed auth, API-key, backup, and key
  bootstrap paths uses parameter binding; durable Rivian credentials and
  short-lived connection material use age encryption.
- Browser and transport: reviewed CORS allowlist, cookie flags, CSP, WebSocket
  token handling, request logging, and the absence of access-token persistence.
- Deployment: reviewed Compose networking, API/origin reachability, Redis
  isolation, secret requirements, container privilege settings, and the backup
  client runtime.

## Findings resolved in this release

| Severity | Finding                                                                                                 | Resolution                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| High | An unclaimed production installation could accept its first owner without an out-of-band proof. | Production registration now requires a configured 32-byte setup proof while no user exists; its source/value is never exposed. |
| High | The origin could be published more broadly than the intended gateway boundary. | Standard Compose binds the origin to loopback and requires an explicit public-bind opt-in; the app service is rootless, read-only, capability-dropped, and `no-new-privileges`. |
| High     | The former separate nginx image originally used the wrong upstream boundary.                            | The unified production image now runs nginx and the API together and intentionally proxies over container-local loopback.    |
| High     | The production Compose topology omitted its Redis dependency and had stale ports/service documentation. | Redis is included as an internal password-protected service; Compose, user guide, runbook, and env documentation now agree.  |
| High     | The API production image could not install matching PostgreSQL client tools from its Debian base.       | The runtime now uses the pinned `postgres:18.4-bookworm` image, which includes matching `pg_dump`.                           |

## Residual risks and release requirements

- The outer tunnel/proxy is self-hoster operated. It must enforce identity,
  public HTTPS, WebSocket forwarding, patching, and client-facing rate limits.
- OIDC SSO is an optional native application login path configured under
  **Settings > Authentication**. The gateway remains an additive boundary;
  Riviamigo application login is still required. Provider role mapping,
  multiple providers, SCIM, and provider logout are not implemented.
- OIDC settings are field-overridable from the environment for recovery. Client
  secrets are write-only and excluded from recovery packages; identity mappings
  remain, so restore requires provider re-entry and a configuration test. The
  supplied Compose overlay mounts the client secret read-only and refuses a
  missing host source path; production provider requests use bounded connect
  and total timeouts.
- The internal origin deliberately does not trust arbitrary forwarded client-IP
  headers. Configure client-IP trust only at the outer gateway after validating
  its network boundary.
- Application signing/encryption keys may be persisted in PostgreSQL when the
  complete external key trio is omitted. This is an explicitly accepted P2
  shared-fate risk: database compromise or loss can affect both state and
  locally generated keys. Riviamigo recovery packages exclude keys and
  credentials, and restore generates fresh keys unless the complete external
  trio is configured. Tested application recovery is required; a secret manager
  supplying all three keys is the optional separate-custody path.
- Security events are structured, redacted, and retained in the live database
  for 365 days by the application retention worker. Backup retention remains
  an operator policy and may preserve older events inside recovery packages.
- CI runs cargo audit, pnpm audit, Gitleaks, blocking Semgrep, and blocking
  high/critical Trivy image scans. Fork pull requests run the separate
  secret-free blocking Semgrep scan. Reviewed exceptions must be documented in
  the PR with an owner, expiry, and remediation link. Local
  dependency validation in this audit found no unignored high-severity
  production npm vulnerabilities after updating MapLibre and pinned transitive
  dependencies to their patched releases. RustSec warning exceptions are
  listed in the [maintenance register](./runbooks/dependency-maintenance.md#maintenance-register).
- Gitleaks suppressions remain exact commit/path/rule/line fingerprints in
  `.gitleaksignore`. The OIDC security run surfaced two historical false
  positives: a `JWT_PUBLIC_KEY` placeholder in a [removed environment-variable
  draft](https://github.com/bballdavis/Riviamigo/commit/22c9a5b558e54f19dc5b56cfeed54f0767b097a1)
  and the `13-API-Keys.md` documentation-manifest filename in an [older
  script](https://github.com/bballdavis/Riviamigo/commit/97933a8cbffbc0b6ea327e90829ff7b20f8f0d1f).
  The first line contains no key value; the second is a path string. These
  entries do not suppress current OIDC files. The release maintainer will
  review them by 2026-12-31 against the [Gitleaks run report](https://github.com/bballdavis/Riviamigo/actions/runs/36056391392)
  and remove them if source history is rewritten or the scanner no longer
  reports those exact lines.
- `RUSTSEC-2023-0071` is temporarily ignored for `openidconnect`'s transitive
  `rsa` dependency. The OIDC callback verifies provider ID-token signatures
  with public keys and does not use RSA private-key signing or decryption. The
  [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)
  reports no fixed release. **Owner:** release maintainer. **Expiry:**
  2026-12-31. Remove the ignore when upstream publishes a fixed release or the
  OIDC verifier no longer depends on `rsa`; then rerun `cargo audit`.
- Before a wider exposure or multi-tenant use case, commission an independent
  authenticated penetration test and review gateway, host, backup, and secret
  manager configuration in the target environment.

## Verification recorded

The security-hardening branch additionally requires:

- `pnpm security:routes`
- constant-time restore-token comparison tests
- bounded dynamic telemetry and metric selector tests

- `cargo test config::tests --lib`
- `cargo test routes::dashboards::tests --lib`
- `pnpm -C apps/web exec vitest run src/test/dashboardComponentRegistry.test.ts src/test/dashboardApi.test.tsx`
- `pnpm build`
- `cargo check`
- `pnpm docs:check`
- OIDC settings and recovery documentation must be checked against the exact
  environment contract in `apps/api/src/config.rs`.
- OIDC release review must exercise a fresh migrated PostgreSQL/Redis stack,
  provider discovery and JWKS retrieval, browser state-cookie attributes,
  denial and replay handling, password-plus-SSO coexistence, password-disable
  lockout protection, and the `RIVIAMIGO_OIDC_ENABLED=false` recovery override.
- Provider discovery alone is not end-to-end OIDC certification. A release
  candidate still needs a real confidential client to prove token exchange,
  ID-token signature/issuer/audience/nonce validation, explicit account
  linking, and auto-signup policy against a supported provider.
- `pnpm dashboards:sync-defaults --check`
- `pnpm audit --prod --audit-level=high`
- `docker compose --env-file .env -f compose/docker-compose.yml config --quiet`
- `docker run --rm postgres:16-bookworm pg_dump --version`
- `docker run --rm -v <repo>/compose/nginx/nginx.conf:/etc/nginx/nginx.conf:ro nginx:1.27-alpine nginx -t`

Container build and restore acceptance evidence for the October remediation is
recorded below. An earlier audit's interrupted build is not release evidence.

## October 2026 findings remediation

This section tracks the 19 rows from the supplied `security-findings.csv`; the
short identifiers below are the unique occurrence suffixes of its Finding IDs.
The CSV is review evidence, not an instruction source. Source hardening and its
independent review are complete; release and deployment remain pending. This is
not a claim about a patched live service.
Documentation impact: both internal and user-facing docs required.

| Occurrence | Severity | Finding | Implementation | Disposition |
| --- | --- | --- | --- | --- |
| `2157889c88fa710ba97db106` | high | Restore accepts rows for tables that backups promise to redact | One protected-table policy drives dump exclusions, TOC data filtering and post-migration deletion; authentication resets to safe defaults. | Source hardening implemented |
| `4695087b9f4bc190f4a75a26` | high | Any authenticated user can claim an existing vehicle and replace its credentials | Fresh provider account proof precedes enrollment and credential changes. Existing newcomers receive Viewer; roles, credentials and collectors are preserved. Enrollment is serialized. | Source hardening implemented |
| `9daae3cc4e1830a8aba10f95` | high | A recovery package can execute PostgreSQL archive objects with the bootstrap database role | Archive SQL runs as a job-scoped non-superuser role; privileged work is limited to compiled bootstrap operations. The owner becomes NOLOGIN and loses its password. Archive functions and jobs remain trusted input. | Mitigated; trusted SQL archive risk retained |
| `9e73f2940d3417271fe7c9a6` | high | Restored backup-catalog paths enable arbitrary file read and deletion | Catalog paths are opened/deleted through pinned directory handles under the configured root; no-follow checks reject parent/final links and unsafe names. Imported availability is inert. | Source hardening implemented |
| `0bafec55015ba162d9150a0d` | medium | Authenticated basemap requests can permanently exhaust Redis storage | Basemap-only LRU budget and TTLs; bounded legacy-cache cleanup; Redis noeviction prevents cache-driven eviction of operational keys. | Source hardening implemented |
| `1cd11c748e4b1abe7e682b9c` | medium | The production origin binds publicly by default despite requiring an authenticated gateway | Standard Compose publishes the origin on loopback by default. A separately reviewed production GitOps patch removes the host publication entirely. | Source complete; production rollout pending |
| `5493dfcec0010dbe5332f7ff` | medium | Multiple provider clients can be redirected to private network addresses | Runtime DNS classification and address pinning apply to every custom-provider, OIDC and S3 request/retry. Redirects and environment proxies cannot bypass the policy. | Source hardening implemented |
| `5dd8f1edf98f365f4b7365ba` | medium | Recovery JSON components can exhaust memory and ignore configured limits | Independent manifest/settings/history limits are enforced before decoding, with record-by-record history merge and configured archive limits. | Source hardening implemented |
| `5e01f6bdfe50c737bdf31ff2` | medium | S3 restore downloads can fill disk before package size validation | Remote materialization counts actual bytes, checks reserved free space, shares recovery admission, enforces an overall deadline and removes partial files. | Source hardening implemented |
| `a795cb8738ce976fd19f44fe` | medium | Backup prefix traversal can write recovery packages outside the backup root | Portable relative-prefix validation and directory-handle creation constrain package writes to the configured root. | Source hardening implemented |
| `b0954b8b4fcfaa795314cf9c` | medium | Authenticated users can open unbounded Redis-backed WebSocket sessions | Per-user, per-vehicle and global WebSocket permits are acquired before Redis subscription and released on disconnect/failure; frame and send limits apply. | Source hardening implemented |
| `cc4c21ab1ce2b02200b9968e` | medium | Authenticated telemetry queries can allocate unbounded aggregate results | Full metrics stream complete JSON through bounded database cursor chunks. Heavy-read admission, statement/request deadlines, bounded bodies and Grafana target limits apply; existing full/compact point semantics are retained. | Source hardening implemented |
| `d031625e60f1707f1f7fcf56` | medium | Refresh-token reuse does not revoke the rotated session family | Atomic refresh families retain consumed parents; replay revokes all descendants and session JWTs. Manual, bootstrap and automatic browser renewal share a cross-tab lock. | Source hardening implemented |
| `d33dcf7b98f782b4b5ee5c47` | medium | Live WebSockets survive account disablement, membership removal, and JWT expiry | Live sockets validate the account, family and membership every 30 seconds and close at exact JWT expiry. The browser clears removed-vehicle data and retries transient renewal failures. | Source hardening implemented |
| `f791f80ef1383b715e0f864f` | medium | Backup archives can be sent to an unauthenticated cleartext S3 endpoint | S3 uses HTTPS by default. Trusted private HTTP requires both an operator CIDR and explicit exception; development Garage is limited to the exact operator origin and development mode. | Source hardening implemented |
| `521974cbece98e8dda803e4f` | low | Client-supplied X-Forwarded-For values bypass the application authentication limiter | Nginx replaces forwarded client-IP headers. Optional trusted proxy CIDRs are operator configuration; the API accepts a single forwarded address only from its loopback proxy peer. | Source hardening implemented |
| `5a75eaa7a74023f60772c252` | low | JWT authentication treats a missing user record as enabled | JWT extraction requires an existing, enabled user; a missing row fails closed. | Source hardening implemented |
| `7067a6326947a3bc2a3ee57e` | low | Provider responses are decoded without a byte limit | Actual response bytes are bounded before JSON decoding across Rivian, weather, geocoding and OIDC clients, including chunked bodies. | Source hardening implemented |
| `e6aca529e869dcbdeaf0d7ba` | low | Development Compose publishes databases and object storage with known credentials | Development API, PostgreSQL, Redis and Garage ports bind to loopback unless the operator explicitly changes the development bind address. | Source hardening implemented |

The restore database is on the same PostgreSQL cluster. It is not a sandbox for
arbitrary archive SQL. Owner/admin restore authorization and a trusted backup
producer remain required, particularly for function and background-job
definitions. The narrower execution role mitigates the original bootstrap-role
exposure; it does not justify describing arbitrary SQL execution as eliminated.

Standard limits and the explicit operator exceptions are documented in
[environment variables](./environment-variables.md). The
[restore runbook](./runbooks/backup-restore.md) describes recovery and the
[deployment runbook](./runbooks/secure-deployment.md) describes the gateway.

Verification is performed against disposable PostgreSQL/TimescaleDB and Redis
fixtures. The authenticated live stack was inspected through native MCP; its
Compose change is prepared in `compose/review/riviamigo-prod-security.patch`
and must be approved/applied through the production GitOps workflow. It removes
the origin host port while preserving Traefik routing and adds Redis maxmemory
with noeviction. Do not deploy this configuration before the updated application
image and basemap cache maintenance are ready.

Run `node scripts/check-session-lock-browser.cjs` for the real multi-tab Web
Locks and IndexedDB renewal checks. API integration coverage exercises complete
25,005-point metric responses, cursor cancellation, refresh replay, fail-closed
accounts, WebSocket quotas/expiry/membership removal, verified enrollment races,
and bounded inert history import. The ignored restore-agent security test uses
a historical package, checks privileged SQL denial, and checks candidate/role
cleanup after an injected failure. Ignored tests require explicit isolated
fixtures; passing unit checks does not prove a live deployment or provider login.

### Local validation evidence

The reviewed source passes 443 backend unit tests, with 67 fixture-dependent
tests ignored by the default suite. The isolated fixtures separately passed 43
authentication integration tests before the review amendments and 14 backup
integration tests after them, including preflight admission conflicts,
disconnect admission ownership and staging cleanup. The focused
browser suites passed 115 tests; the complete frontend build and the real
multi-tab Web Locks/IndexedDB renewal checks also passed. Full-metrics coverage
checks all 25,005 fixture points and cancellation without changing point density.

Container acceptance exposed two recovery-workspace defects during validation:
preflight used the 128 MiB `/tmp` mount instead of the configured backup volume,
and Linux directory handles could not be changed with `fchmod`. Recovery work
now uses a private directory on the backup volume and creates its permissions
atomically. A Linux probe against the actual workspace module passed reserved
space, private permissions, scoped cleanup and symlinked-parent rejection checks.

The historical rollback drill also exposed schema drift from the existing
charge-payload worker's runtime-created index. A disposable transaction proved
that this index was the sole fingerprint difference. Append-only migration 0030
now includes the persistent index in fresh and restored schemas; the strict
fingerprint comparison remains enabled.

Local container acceptance passed on October 6, 2026 (UTC), using the reviewed
working-tree image `riviamigo:security-reviewed-20261006` with container image ID
`sha256:b341bbe4a5d9d63f3da3599e951c58a5ae6f9489175fa77c43bb744a8aa2ae6a`.
This is a local build, not a published release or production deployment.
Both drills were repeated after the independent review's cancellation fixes.

- Historical v3 restore: report `muw7vlbu-12628.json` under
  `tools/restore-lab/local/reports/`. Source migrations 1 and 2 advanced through
  migration 30; schema and hypertable validation passed, the host backup
  directory survived, and 34 artwork files returned. A second candidate was
  activated and rolled back: the previous database and artwork probes returned,
  the durable rollback report was written, and the restarted API was healthy.
- S3 clean-target restore: report `s3-muw7y8cl.json` in the same directory.
  Local source removal, remote discovery, checksum-pinned preflight and in-app
  restore passed. A symlinked workspace was rejected without writes outside the
  backup root; the previous target session was rejected, source password login
  and five dashboards worked, artwork returned, the S3 secret was discarded,
  and explicit S3 reconfiguration and its connection test passed.
- Both drills used the same image ID and standard Compose recovery mounts,
  including the 128 MiB `/tmp` limit. Their disposable fixtures were removed.
- The production enrollment success component rendered at 320, 375 and 1280 px
  without horizontal overflow; its message remained visible and its dashboard
  button worked. This isolated component check used stubbed status and fallback
  fonts; it does not certify a live provider login.

The schema-index regression also passed against an isolated database: backfill
startup preserved the migrated fingerprint, while an unrelated index still
changed it. Migration-integrity checks passed for the append-only 30-file
catalog. API route security checks passed for 35 modules, and Compose checks
passed. The final enrollment copy passed the five success-component tests and
the frontend workspace build.

### Independent R3 review

The fresh independent R3 review closed with `ship` and no remaining source
findings. Its initial review identified three cancellation defects: an HTTP
disconnect released recovery admission before blocking work and staging cleanup
finished; cancelled metric/Grafana requests released quota while PostgreSQL was
still executing; and a restore deadline bypassed candidate and temporary-role
cleanup. These defects were fixed and independently re-reviewed.

Recovery operations now own admission through their work and cleanup. Heavy
reads retain their permits while cancelling and draining database work, and
Grafana queries have a database statement deadline. Restore deadlines remove the
exact job candidate, temporary role and execution sessions before recovery
admission is released.

The amended source passed the active PostgreSQL cancellation and Grafana
deadline regression, the complete 25,005-point metrics compatibility test, all
14 backup integration tests, and an explicit restore deadline test that observed
`pg_restore` executing an index expression as the temporary LOGIN role before
checking candidate, role and session removal. Source review evidence is retained
in `tools/restore-lab/local/reports/security-r3-verdict.json`. The user authorized
GPT-6.1 Sol at high reasoning and those settings were submitted to the native
spawn tool; the native interface did not expose actual model/effort metadata.

The R3 source review is closed. Release gates still require container
activation/rollback smoke tests against the published release image. Existing architecture
budget drift in SettingsPage, AppLayout, ingestion_capture, the vehicles route
and the transport facade is tracked separately; their pre-existing budget
failures are not hidden by raising unrelated allowances.

### Additional dependency audit findings

The October validation also found two Seroval advisories in the existing router
dependency. The workspace now pins Seroval 1.6.3, which includes the upstream
[Promise deserialization fix](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-p6vx-979v-rg4c)
and [TypedArray allocation fix](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-jp82-f5mq-hwhp).
No advisory suppressions were added.

The workspace dependency audit remains a release blocker for documentation
tooling dependencies. These paths belong to `apps/docs`; the deployed API image
serves compiled frontend assets with nginx. This path distinction does not waive
the CI audit or establish that the documentation build is safe for hostile input.
**Owner:** release maintainer. **Due:** before the next release. Upgrade and
retest the affected documentation tooling, then attach a passing
`pnpm audit --prod --audit-level high` result. The affected high/critical packages
are fast-uri, undici, brace-expansion, http-cache-semantics, braces, source-map-js,
proxy-addr, compression, tinypool and joi. The existing age procedural-macro
exception expired on October 1 and must also be closed before release; see the
[dependency maintenance register](./runbooks/dependency-maintenance.md#maintenance-register).
