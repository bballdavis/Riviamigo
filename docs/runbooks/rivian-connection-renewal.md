---
title: Rivian connection renewal
description: Diagnose and verify advisory or required Rivian credential renewal without exposing tokens.
---

# Rivian connection renewal

Use this runbook when the sidebar recommends renewal, a vehicle reports
`reauth_required`, or telemetry does not recover after **Refresh Rivian login**.

## Interpret the status

- `renewal_soon` begins seven days before the estimated 180-day renewal date.
- `renewal_due` means the estimate has passed; it is not proof that Rivian has rejected the token.
- `reauth_required` is based on an observed authentication failure and overrides the estimate.
- Normal CSRF/application-session rotation and WebSocket TTL reconnects do not reset the estimate and do not require user action.

Rivian does not publish a supported token-lifetime contract. Treat the timer as
preventive maintenance and use runtime authentication evidence as authoritative.

## Renew and verify

1. Open **Settings → Vehicles** and choose **Refresh Rivian login** for the affected vehicle.
2. Complete Rivian MFA if requested. Do not copy passwords, OTP values, or tokens into logs or support records.
3. Wait for the completion state. `ready` means the worker authenticated and vehicle discovery succeeded. `waiting` means the credentials were retained but runtime readiness did not arrive within the bounded check.
4. Confirm the vehicle card shows the new estimated date and no `reauth_required` state.
5. Confirm the sidebar updates without a browser reload and live telemetry reconnects.
6. Check application logs for the vehicle-scoped refresh and worker-health events. Do not enable payload or credential logging.

If the result remains `waiting`, inspect worker health and Rivian API errors
before repeating authentication. A sleeping vehicle may delay telemetry, but
vehicle discovery should still succeed. Password changes, account unlinking,
permission removal, and Rivian-side revocation can invalidate credentials before
the estimate.

## Release verification

After changing this behavior, verify the renewal-state boundary tests, manual
credential timestamp reset, CSRF timestamp preservation, health-gated reconnect,
frontend query invalidation, and live-socket reconnect. For production, also
verify the immutable deployed revision and container health through the native
GitOps and Komodo records.
