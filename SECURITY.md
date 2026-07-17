# Security Policy

## Reporting a vulnerability

Please report sensitive vulnerabilities privately through [GitHub Security Advisories](https://github.com/bballdavis/Riviamigo/security/advisories/new). Do not open a public issue with credentials, tokens, exploit details, production data, live telemetry, or precise vehicle locations.

Public security issues are appropriate only for non-sensitive dependency, CI, documentation, or deployment hardening concerns. The public security issue form repeats this boundary and links to the private advisory flow.

## Release security expectations

Dependency and secret-scan failures are release blockers. High-risk Semgrep findings and critical/high Trivy image findings are also blocking unless a maintainer records a reviewed, time-bounded exception in the pull request and tracks the remediation.

Riviamigo is not approved for direct Internet exposure. Review [`docs/security.md`](docs/security.md), [`docs/security-audit.md`](docs/security-audit.md), and the secure-deployment runbook before deploying or publishing a release.
