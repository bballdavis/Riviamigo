## Summary

<!-- What changed, why, and what user or maintainer outcome does it provide? -->

-

## Change type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor or maintenance
- [ ] CI, release, or workflow change
- [ ] Documentation-only change
- [ ] Security or privacy change

## Affected areas

- [ ] Frontend or dashboard
- [ ] Backend or API
- [ ] Database, migrations, backup, or restore
- [ ] Authentication or authorization
- [ ] Ingestion or vehicle connection
- [ ] Deployment or containers
- [ ] CI or release process
- [ ] Documentation

## Scope, risk, and compatibility

- User-visible behavior:
- Operational or deployment impact:
- Migration or rollback considerations:
- Known limitations or follow-up work:

## Verification

Checks run locally or in CI:

- [ ] Focused tests closest to the changed seam
- [ ] `Quality` workflow passed
- [ ] `Frontend` workflow passed when frontend or shared UI code changed
- [ ] `Backend` workflow passed when Rust/API/database code changed
- [ ] `Security` workflow passed for the target commit
- [ ] `Runtime` workflow passed for deployment or release changes
- [ ] `Fresh install acceptance` passed for release or installation changes
- [ ] `pnpm docs:check` passed when docs, routes, env, auth, or operations changed
- [ ] Browser/mobile verification completed when shared UI behavior changed

Evidence, commands, or CI links:

-

## Release readiness

<!-- Complete this section for changes targeting main or a release. -->

- [ ] The source branch contains the intended release candidate
- [ ] No unexplained required check is failing or pending
- [ ] Migrations, environment variables, deployment behavior, and rollback impact were reviewed
- [ ] Release and user-facing documentation are aligned with actual behavior
- [ ] Security and privacy risks were reviewed, including telemetry exposure and failure behavior
- [ ] Generated files, secrets, credentials, private keys, and production data are absent from the diff

## AI Assistance and Security

- [ ] No AI assistance was used
- [ ] AI assistance was used, and the generated work was human-reviewed and verified
- [ ] No secrets, tokens, private keys, production data, or precise vehicle locations are present in the diff, fixtures, logs, or prompts
- [ ] Auth, authorization, telemetry privacy, and failure behavior were reviewed when relevant

If AI assistance was used, briefly describe its scope and the human verification performed:

-

## Documentation Impact

- [ ] No doc impact
- [ ] Internal doc update required
- [ ] User-facing doc/wiki update required
- [ ] Both internal and user-facing docs required

Docs touched:

-

If docs are intentionally deferred, link the tracked doc-debt follow-up here:

-

## Visual System Review

- [ ] Not a UI/visual change
- [ ] Reviewed against `docs/branding.md`
- [ ] Shared primitives/patterns were reused where appropriate
