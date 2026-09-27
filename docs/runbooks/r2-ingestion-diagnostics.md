---
title: R2 ingestion diagnostics
description: Trace R2 acquisition, typed decoding, canonical telemetry, and sparse trip detection.
---

# R2 ingestion diagnostics

Use this when a connected R2 shows missing status fields or trips. The API
already runs Parallax acquisition in-process. The UI switch starts the extra
diagnostic events; `logs -f` only displays the API output. There is no standalone
logger, container, or downloadable capture. Keep VINs, account data, exact
coordinates, tokens, secrets, and raw payloads out of reports.

## Collect a diagnostic window

1. From the repository root, start the standard stack if needed:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

   Then follow the existing API output:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo
   ```

   Use the operator's equivalent commands for another deployment.
2. Check **Health → Acquisition** and **Settings → Raw data → Collector
   diagnostics** for socket, heartbeat, reconnect, and decoder context.
3. In **Settings → Raw data**, an owner or manager enables **Ingestion
   diagnostics** for the affected non-demo vehicle. It runs for up to one hour
   and adds diagnostic events; it does not enable ingestion. Allow up to 30
   seconds for the worker to pick up the switch.
4. Create or wait for a real vehicle update. Share only redacted diagnostic
   lines, then turn the switch off.

## Symptom → next check

- `vehicle ingestion diagnostics`: compare source, field presence, and sample
  age with the requested topic.
- `typed Parallax frame rejected`: investigate the named topic and decoder
  reason.
- `vehicle trip diagnostics`: check power joining, derived speed, and trip
  transitions; sparse or sleeping updates may not produce a trip.
- `validated Parallax telemetry could not reach canonical worker`: inspect the
  bounded handoff; the normalized Parallax reading may still be stored.
- No topic or event: check Acquisition and upstream availability. A connected
  socket proves the subscription and heartbeat, not every topic.

For the owner-facing procedure, see [Extended Vehicle Telemetry](../guides/extended-vehicle-telemetry.md).
