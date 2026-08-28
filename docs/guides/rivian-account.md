---
title: Rivian account setup
description: Connect a Rivian account and handle MFA or authentication repair.
slug: /getting-started/rivian-account/
---

# Rivian account setup

After you create your Riviamigo owner account, open **Settings → Vehicles** and choose **Add Vehicle**.

1. Enter the email address and password for your Rivian account.
2. Complete the one-time passcode (OTP) Rivian sends through its normal authentication flow.
3. Riviamigo encrypts the credentials at rest, saves the vehicle, and starts its
   telemetry collector. The completion screen distinguishes that durable save
   from telemetry readiness.

If Rivian rejects the email, password, or verification code, Riviamigo shows that specific correction beside the form. If the secure sign-in handoff expires before the vehicle is added, start again from the account step.

The first update can take a little while, especially if the vehicle is asleep.
You can open the dashboard while the collector starts. If startup reports that
it needs attention, use the vehicle health details and app logs; successfully
saving a vehicle does not require a container restart. Riviamigo uses Rivian's
unofficial API and WebSocket behavior, so upstream changes can occasionally
require a project update.

## Estimated connection renewal

Riviamigo records the time of each complete Rivian sign-in and shows an
estimated renewal date 180 days later. Starting seven days before that date,
the sidebar and **Settings → Vehicles** recommend refreshing the Rivian login.
The estimate is based on current behavior documented by unofficial Rivian
clients; Rivian does not publish a supported token-lifetime contract.

This reminder is preventive, not a statement that the connection has already
expired. A password change, account unlink, or Rivian-side revocation can still
require an earlier sign-in. Riviamigo automatically renews the shorter-lived
CSRF and application-session pair without moving the 180-day estimate, but a
complete Rivian account renewal remains a user-assisted flow.

Choose **Refresh Rivian login** on the vehicle card. Completion waits for the
new credentials to be verified and for vehicle discovery to succeed. The
sidebar, vehicle list, health state, and live telemetry connection then refresh
without a browser reload. If credentials are saved but telemetry is still
starting, Riviamigo keeps the new credentials and shows a recoverable waiting
state.

## Troubleshooting

- Watch the app logs with `docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo`.
- If authentication expires or is revoked, use **Refresh Rivian login** on the existing vehicle. Removing the vehicle is not required.
- If an OTP does not arrive, confirm the phone number on the Rivian account and retry from Settings.
- If the app reports temporary secure-session storage is unavailable, do not keep retrying Rivian credentials. Confirm the Riviamigo container is healthy, then inspect its logs for `secure_session_store.unavailable`; this means the server cannot authenticate to or reach its Redis session store.

Rivian requests carry the information necessary to authenticate and collect vehicle data. See [privacy](../privacy.md) for the wider data-flow picture.
