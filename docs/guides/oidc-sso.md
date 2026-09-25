---
title: OIDC single sign-on
description: Configure OIDC single sign-on, account linking, safe recovery, and environment overrides.
slug: /getting-started/oidc-sso/
sidebar_label: OIDC single sign-on
---

# OIDC single sign-on

Riviamigo can use one OpenID Connect (OIDC) provider for single sign-on (SSO).
SSO is disabled by default, and local password login remains enabled by default.
The first owner must still be created through the normal local setup flow; OIDC
does not replace the first-owner setup proof.

This guide covers the operator contract. It does not certify a particular
provider or gateway configuration. Test the complete flow in a disposable
account before changing the production login policy.

## Prerequisites

- A working Riviamigo installation with a local `super_user` account.
- An HTTPS public application URL behind the required authenticated gateway.
- An OIDC provider that supports discovery, the authorization-code flow, and a
  confidential client. Authentik, Keycloak, Entra ID, and other standards-
  compliant providers can be used.
- A client redirect URI copied exactly from Riviamigo after `public base URL`
  is saved.

Riviamigo does not trust arbitrary identity headers from a reverse proxy. The
OIDC provider is contacted by the Riviamigo server and the callback is handled
server-side.

## Register the provider client

Create a confidential OIDC client in the provider. Use the provider's normal
authorization-code flow with PKCE S256. Riviamigo sends an S256 code challenge
and supplies the matching verifier during the token exchange.
Request at least the `openid email profile` scopes unless your provider uses a
different claim arrangement. The `openid` scope is mandatory. Riviamigo can
read a verified email and a required custom claim from either the verified ID
token or the subject-bound UserInfo response.

In Riviamigo, open **Settings > Authentication** as a super-user and enter the
provider issuer, public base URL, client ID, and client secret. Save the
configuration while OIDC is still disabled. Riviamigo shows the callback URL in
the settings response after a public base URL is present:

```text
https://riviamigo.example.net/v1/auth/oidc/callback
```

Register that exact URL at the provider. Do not add a wildcard, a trailing path,
or a different scheme/host. The client secret is write-only; Riviamigo reports
only whether one is configured.

### Logout behavior

Riviamigo currently supports local logout only. **Sign out** clears the
Riviamigo session and revokes its refresh token, but it does not call the
provider's OIDC end-session endpoint or clear the provider's browser session.
There is no OIDC logout callback or post-logout redirect URI to register for
Riviamigo. Leave the provider's logout URL or post-logout redirect setting
empty where possible. Do not use `/v1/auth/logout` as a provider logout URL; it
is a `POST` endpoint for clearing Riviamigo's local session, not a browser
redirect endpoint. If the provider session remains active, the next SSO attempt
may sign the user back in without asking for credentials.
When automatic SSO login is enabled, an explicit **Sign out** leaves the login
page open for that visit instead of immediately starting SSO again. The user
can still select the SSO button manually. Opening the login page later follows
the configured automatic login behavior.

### Configure OIDC through standard Compose

For a standard Compose installation, add the OIDC entries from
`compose/.env.full.example` to the repository-root `.env`. On a new install,
you can use the full template as the starting `.env`. The standard Compose
file passes the root `.env` to the app through its `env_file`; it does not need
a separate Compose entry for each
supported variable. Use the direct `RIVIAMIGO_OIDC_CLIENT_SECRET` value in this
path, keep the secret file variables commented, and never commit the populated
`.env` file. Restrict the populated file to its owner, for example with
`chmod 600 .env` on Linux, and use the equivalent private file permissions on
Windows or a NAS.

For example, set the provider connection and policy in the root `.env` while
leaving password login enabled for the first test:

```dotenv
RIVIAMIGO_OIDC_ENABLED=false
RIVIAMIGO_PASSWORD_LOGIN_ENABLED=true
RIVIAMIGO_OIDC_ISSUER_URL=https://auth.example.net/application/o/riviamigo/
RIVIAMIGO_OIDC_PUBLIC_BASE_URL=https://riviamigo.example.net
RIVIAMIGO_OIDC_CLIENT_ID=replace-with-client-id
RIVIAMIGO_OIDC_CLIENT_SECRET=replace-with-client-secret
RIVIAMIGO_OIDC_AUTO_LOGIN=false
```

Recreate only the application container after changing these values:

```bash
docker compose --env-file .env -f compose/docker-compose.yml \
  up -d --no-deps --force-recreate riviamigo
```

The Settings page remains available as the GUI-managed path; environment
values override only their matching fields and appear read-only there. With
the initial `RIVIAMIGO_OIDC_ENABLED=false`, run **Test provider** and link an
enabled super-user through the GUI first. After those checks succeed, change
`RIVIAMIGO_OIDC_ENABLED=true` in `.env` and run the same app-only recreate
command; an environment-owned toggle cannot be changed from the GUI.

### Optional: mount the client secret with a Docker Compose overlay

The repository includes an opt-in overlay so the production container can read
the client secret without placing it in the dotenv file. On a Linux host,
create a file that is readable by the container's fixed `1001:1001` user:

```bash
sudo install -d -o root -g root -m 0750 /opt/riviamigo/secrets
sudo install -o 1001 -g 1001 -m 0400 /dev/stdin /opt/riviamigo/secrets/oidc-client-secret
```

Enter the secret on standard input, then set only the host source path in
`.env`:

```dotenv
RIVIAMIGO_OIDC_CLIENT_SECRET_SOURCE=/opt/riviamigo/secrets/oidc-client-secret
```

Start or recreate the app with both Compose files:

```bash
docker compose --env-file .env \
  -f compose/docker-compose.yml \
  -f compose/docker-compose.oidc-secret.yml \
  up -d
```

The overlay sets `RIVIAMIGO_OIDC_CLIENT_SECRET_FILE` inside the container and
refuses to create a missing host path as a directory. Do not also set
`RIVIAMIGO_OIDC_CLIENT_SECRET` in the root `.env`. Do not set
`RIVIAMIGO_OIDC_CLIENT_SECRET_FILE` without this overlay: the standard Compose
file does not mount the file, and startup will fail when it cannot be read.
`RIVIAMIGO_OIDC_CLIENT_SECRET_SOURCE` alone is inert because Riviamigo does not
read that host path; it only becomes useful when the overlay consumes it. On
Docker Desktop, use a file path shared with
the Docker VM and verify it is readable from the container before enabling
SSO.

## Enable SSO safely

Use this order for a first configuration:

1. Keep **Enable SSO** off and **Allow password login** on.
2. Save the issuer, public base URL, client ID, secret, scopes, and token
   authentication method.
3. Select **Test provider**. A successful result proves that provider
   discovery and JWKS retrieval work, that the provider's authorization,
   token, and JWKS endpoints use HTTPS, and that the configured callback URL
   is an absolute HTTPS URL. It does not validate the client credentials at
   the token endpoint or prove that every gateway, browser, or user claim is
   correct.
4. While still signed in as the local super-user, open **Settings > Account**
   and select **Connect SSO**. This explicit link is available before SSO is
   exposed on the login page.
5. Confirm that the expected provider identity is linked and that the local
   password remains usable.
6. Enable OIDC. The SSO button is hidden while OIDC is disabled.
7. Sign out and complete one login through the SSO button.
8. Only after that end-to-end login succeeds, consider disabling password
   login. The GUI refuses this change until the provider was tested and an
   enabled super-user has linked an OIDC identity.

The default SSO button label is `Sign in with SSO`; change it with the setting
or `RIVIAMIGO_OIDC_BUTTON_LABEL`.

## Existing accounts and new accounts

Administrators choose **Password only**, **SSO only**, or **Password and SSO**
when inviting a new account. The invite form defaults to the sign-in methods
currently available on the site: password when only password login is enabled,
SSO when only a ready SSO connection is enabled, or both when both are available.
The recipient can activate with either allowed method when both are selected.
An SSO activation requires the invitation link and an identity whose verified
email matches the invited address. Auto-signup and verified-email auto-linking
do not replace that invitation check. The selected methods stay with the new
account: an SSO-only invite cannot later set a password, and a password-only
invite cannot later connect SSO. A site-wide change can make an invitation's
selected method temporarily unavailable; an administrator can restore that
method or revoke and replace the invitation. Invitations are for new accounts;
existing account holders connect SSO from **Settings > Account**.

An existing local account may have both a password and an OIDC identity. Use
the signed-in account's identity-link action when available; do not create a
second account merely because the provider supplies the same email address.
The provider identity is keyed by issuer and subject, not by email alone.

Automatic behavior is intentionally conservative:

- Auto-signup defaults off.
- Verified-email auto-linking defaults off.
- When enabled, auto-linking requires a matching email that the configured
  provider marks as verified. By default, any verified email domain qualifies.
- Auto-signup creates a normal basic user. It does not grant administrator,
  vehicle, or manager access from provider claims.
- Invitations and Riviamigo membership rules remain the authority for access.

The **Account access** form leaves **Allowed email domains**, **Required claim
name**, and **Required claim value** empty by default. This is the broad
setting: when automatic signup or linking is enabled, any verified email
domain from this provider qualifies, with no extra claim required. There is no
generic claim name and value to prefill. The standard OIDC `email` and
`email_verified` claims are read automatically; putting `email` in **Required
claim name** would check for an additional provider claim instead. The
optional controls are under **Show advanced account access** and open
automatically if restrictions are already configured.

Enable automatic linking only after deciding whether your provider's verified
emails are reliable for existing Riviamigo accounts. A matching verified email
grants access to the existing account, including its current role and vehicle
memberships. Authentication at the provider alone does not prevent a different
provider user from receiving a shared or reassigned address. Explicit
signed-in linking avoids that email match. The optional domain list is
a comma-separated, case-insensitive admission rule for auto-link and
auto-signup. A required claim is an exact claim name/value rule enforced on
every OIDC login, including identities that are already linked. Configure the
claim name and value together, or leave both empty.

An account created through OIDC auto-signup starts without a local password.
The user can open
**Settings > Account**, choose **Set a recovery password**, and complete a
fresh OIDC verification with the exact identity already linked to the account.
Only then does Riviamigo save the password. The operation revokes the account's
other refresh sessions and cannot be used to attach a different provider
identity. Afterward, the account can use both password and SSO login and may
disconnect SSO by confirming the local password.

## Environment-managed fields

Every authentication field has database settings and an optional environment
override. An environment value wins for that field only; it does not replace
the other database settings. The Authentication settings page identifies the
source of each value as database or environment. Environment-owned fields are
read-only in the GUI.

Use `RIVIAMIGO_OIDC_CLIENT_SECRET` or, preferably, mount a secret and use
`RIVIAMIGO_OIDC_CLIENT_SECRET_FILE`. They are mutually exclusive. Never commit
either value or paste it into an issue. See the complete [environment variable
reference](../environment-variables.md).

Environment overrides are useful for deployment automation and emergency
recovery. Database settings remain the normal GUI path. Changing any effective
provider connection value, including an environment-supplied client secret,
invalidates the prior provider test; run **Test provider** again before the GUI
will permit password login to be disabled.

## Disabling local password login

Password login can be hidden and rejected by turning off **Allow password login**.
The GUI permits this only after the saved provider configuration has
passed its test and an enabled super-user has linked OIDC. Still record and
rehearse the recovery procedure below before changing the policy. The
first-owner setup path still requires its local setup proof.

For a reversible deployment-level policy, set:

```dotenv
RIVIAMIGO_OIDC_ENABLED=true
RIVIAMIGO_PASSWORD_LOGIN_ENABLED=false
```

To start SSO automatically when someone opens the login page, enable
**Automatically login to SSO** in the same **Sign-in options** group. This setting
defaults to off. It takes effect when SSO is enabled and ready, whether or not
password login is enabled. The equivalent deployment override is
`RIVIAMIGO_OIDC_AUTO_LOGIN=true`. A failed SSO start or callback stays on the
login page without another automatic attempt, so the person can retry with the
SSO button or use a password if that option is enabled. First-owner setup still
uses its local setup path.

Keep the provider configuration complete when enabling OIDC. A broken or
incomplete provider must not be treated as a successful recovery test.

## Break-glass recovery

If OIDC is unavailable, use an environment override to restore local access.
Keep the PostgreSQL and Redis data; recreate only the application container.

1. Set `RIVIAMIGO_PASSWORD_LOGIN_ENABLED=true` and
   `RIVIAMIGO_OIDC_ENABLED=false` in the deployment environment. Remove any
   malformed or stale OIDC overrides, especially `RIVIAMIGO_OIDC_CLIENT_SECRET_FILE`
   and `RIVIAMIGO_OIDC_CLIENT_SECRET_SOURCE`.
2. Recreate only the Riviamigo application container with the standard Compose
   file. Do not include the optional OIDC secret overlay during recovery: the
   committed startup code parses OIDC overrides before the app can serve the
   local login. Do not delete the database, Redis data, or backup volume.
3. Sign in with the existing local super-user account.
4. Repair the provider values in **Settings > Authentication**, test them, and
   verify the callback URL and account link.
5. Remove the temporary environment overrides.
6. Recreate only the application container again and verify the intended SSO
   and password policy.

If the deployment cannot be recreated, apply the same values through the
container/orchestrator's environment editor and restart only the app service.
Do not reset the database to recover authentication.

This is an operator break-glass procedure, not an end-user password-reset
flow. Preserve and periodically test at least one local super-user password.
An account invited as SSO only cannot use or create a password during an SSO
outage. Accounts created through OIDC auto-signup can set a recovery password
through **Settings > Account** before an outage.

## Backup and restore

Recovery packages intentionally exclude the `authentication_settings` table
data, including the encrypted OIDC provider configuration and client secret.
The restore pipeline recreates that singleton with safe defaults: OIDC off,
password login on, and no provider secret. The `user_oidc_identities` mappings
remain part of the database state. After a restore, sign in with the preserved
local super-user password, then re-enter and test the provider configuration
before enabling SSO. This design prevents a recovery package from carrying a
provider secret to another installation while preserving account identity
relationships.

Follow [Backup and restore](./backup-and-restore.md) and test a package in an
isolated installation before relying on it for production recovery.

## Troubleshooting

| Symptom | Meaning and next step |
|---|---|
| SSO button is absent | OIDC is disabled, not ready, or an environment override hides it. Inspect **Settings > Authentication** as a super-user. |
| Password form is absent | Password login is disabled. Use the break-glass procedure if SSO is unavailable. |
| Provider rejects the callback | Check the exact issuer, public base URL, and registered callback URI. |
| Configuration test says a value is missing | OIDC requires an issuer, public base URL, client ID, and client secret. Save all four values, confirm the displayed callback URL, and test again. |
| Existing account is not linked | Verified-email auto-linking is off by default; use explicit signed-in linking. |
| Automatic linking is refused | The provider must return a verified email matching an enabled local account. Check any configured domain or required-claim restrictions. |
| New user is refused | Auto-signup is off or the verified-email, domain, or required-claim rule failed. |
| Restore shows SSO disabled | Re-enter the excluded provider settings, test, and then enable OIDC. |
| Callback reports an expired or failed login | Start a new SSO attempt. Transactions are one-time and are consumed even when the browser-binding cookie is missing or wrong. |

For a failed callback, check the OIDC failure or rejection entry in the API
console. Its `stage` and `reason` fields identify where the attempt stopped
without exposing identity data. A first sign-in with an existing local account
needs either an explicit link from **Settings > Account** or verified-email
automatic linking enabled in **Settings > Authentication**. A new account needs
auto-signup enabled and an eligible verified email. Provider verification and
session or audit storage can also fail; use the logged stage before changing
account access policy. The local `dev:stack` launcher sends API logs to its own
terminal.

Do not put authorization codes, tokens, client secrets, or complete identity
claims in logs or support reports. Redact email addresses and provider subject
values before sharing diagnostics.

## Security limitations

OIDC complements the secure deployment boundary; it does not make a directly
Internet-exposed Riviamigo origin safe. Keep the application behind an
authenticated HTTPS gateway, exact `ALLOWED_ORIGINS`, and host firewall rules.
Riviamigo does not implement multiple providers, SCIM, provider-driven role
mapping, or provider logout in this configuration. Those are separate design
questions and are not implied by enabling OIDC.

## Deployment acceptance checklist

Complete this checklist against the exact release image and the production
provider before hiding password login:

- Pin the Riviamigo image by immutable digest and run the database migration on
  a tested backup.
- Confirm the external HTTPS URL and exact callback URI through the real
  gateway; do not use a wildcard redirect.
- Run **Test provider**, then complete an actual confidential-client browser
  login. The settings test alone does not prove client credentials, token
  exchange, browser cookies, or claims.
- Prove provider denial, a second use of the same callback, and a fresh retry
  after an expired or invalid transaction.
- Explicitly link an enabled super-user, verify that password and SSO both work,
  and test a qualifying and non-qualifying account for each enabled admission
  rule.
- For auto-signup, verify that the passwordless user can complete the
  provider reauthentication under **Settings > Account**, set a recovery
  password, and then use both login methods.
- Exercise the environment break-glass override and confirm that recreating
  only the app restores the password form.
- Restore a redacted recovery package in isolation and confirm the provider
  settings singleton is recreated with OIDC off and password login on while
  existing identity mappings remain.
- If the secret-file overlay is used, render the merged Compose configuration
  and verify the file from the running `1001:1001` container before enabling
  SSO.
- Record the provider tenant, client owner, client-secret rotation date,
  recovery owner, and the evidence from the end-to-end login test.

The migration allows passwordless auto-provisioned users. Do not roll back to
an older image that assumes every user has a password. Roll forward, or restore
the pre-upgrade database backup after accounting for users created since the
upgrade.

## Design references

The GUI-first model intentionally combines patterns from established open
source systems rather than requiring environment-only setup:

- [Grafana Generic OAuth](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/)
  supports UI-managed authentication plus configuration overrides and keeps
  auto-login and password-form hiding as separate controls. Its warning about
  email lookup is why Riviamigo defaults verified-email auto-linking off.
- [Gitea authentication sources](https://docs.gitea.com/next/administration/authentication/)
  use discovery and treat automatic registration and account linking as
  explicit policy choices. Riviamigo likewise always includes the `openid`
  scope and keeps auto-signup opt-in.
- [GitLab OmniAuth](https://docs.gitlab.com/integration/omniauth/) separates
  sign-in, automatic account creation, and account linking controls; Riviamigo
  follows that separation without importing provider roles.
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
  and [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0-18.html)
  drive exact redirect matching, one-time state, PKCE S256, nonce validation,
  HTTPS provider endpoints, subject-bound UserInfo, and verified ID tokens.
