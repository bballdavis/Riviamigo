---
title: R2 ingestion diagnostics
description: Trace R2 acquisition, typed decoding, canonical telemetry, and sparse trip detection.
---

# R2 ingestion diagnostics

Use this when a connected R2 shows missing status fields or trips. Record the
vehicle's model, firmware, approximate observation window, and the affected
field before changing settings. Keep VINs, account data, exact coordinates,
tokens, and raw payloads out of shared reports.

## Trace the data path

1. Check **Health → Acquisition** for starting, connected, stale, reconnecting,
   or error state, last frame, and decoder counts. This is the separate
   Parallax WebSocket; canonical `vehicleState` ingestion may still be healthy.
2. Check **Settings → Raw data → Collector diagnostics** for normalized
   acquisition metadata. If the collector is not connected, investigate its
   latest connection error and reconnect count before interpreting field gaps.
3. As a vehicle owner or manager, enable **Ingestion diagnostics** on that Raw
   data page. It is limited to non-demo vehicles linked to a Rivian account
   and expires after one hour. Capture API logs during a real update, then
   disable it.
4. Group log events by vehicle ID and source topic. `vehicle ingestion
   diagnostics` shows which canonical fields were present and the sample age.
   `typed Parallax frame rejected` identifies a decoder failure by topic and
   reason. `vehicle trip diagnostics` identifies power joining, derived speed,
   and trip transitions. A `validated Parallax telemetry could not reach
   canonical worker` or `vehicle-state baseline could not reach canonical
   worker` warning indicates a full or closed bounded handoff. Warnings are
   sampled as the process-wide drop count grows; debug logging records each
   drop. These events do not contain precise locations or raw upstream
   messages.
5. If the topic is absent, check acquisition and upstream field availability.
   If it is present but rejected, reproduce the typed decoding with a redacted
   fixture before changing the decoder. If decoding succeeds but a field is
   absent from canonical status, inspect the bounded Parallax-to-worker handoff
   and per-field timestamps. If the field is present but no trip appears, check
   sample freshness and whether at least two plausible moving segments arrived.

For R2, Parallax requests power, GNSS, odometer, closures, locks, tires, and
cabin topics alongside its existing health and energy topics. It writes normalized
readings to `timeseries.parallax_*` and forwards validated R2 state to the
canonical worker. The canonical worker owns latest status, telemetry history,
and trip detection. Parallax cannot create or end a charge session. The
startup `GetVehicleState` request supplies a baseline for legacy fields that
have not changed since subscription.

## Interpret limits

- A connected socket proves subscription and heartbeat, not field coverage.
- Parked or sleeping vehicles may not emit new data during the diagnostic window.
- The trip detector may join power for up to two minutes and infer speed only
  from plausible successive GNSS fixes. It does not alter stored source values.
- The one-hour switch controls log detail only. Host logging and retention
  policies govern those events. The separate canonical raw-event retention
  setting is outside this switch.
- A normalized Parallax reading can still be stored when its canonical-worker
  handoff is full. Use the handoff warning to distinguish this from an upstream
  gap; a later update may refresh current status, but the dropped event is not
  replayed into canonical telemetry history.
- R2S and R2-S remain accepted legacy input labels, but new and migrated
  vehicle records use R2. The migration preserves vehicle UUIDs and history.

For the owner-facing procedure, see [Extended Vehicle Telemetry](../guides/extended-vehicle-telemetry.md).
