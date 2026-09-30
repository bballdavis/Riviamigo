---
title: Vehicle state and trip ingestion diagnostics
description: Trace allowlisted Parallax frames, canonical telemetry fusion, and sparse trip detection for any vehicle model.
---

# Vehicle state and trip ingestion diagnostics

Use this when a connected vehicle shows missing state fields or trips. Parallax
acquisition already runs inside the API process. The Settings switch enables
additional per-frame diagnostics; `logs -f` displays API output. There is no
standalone logger, container, or downloadable capture. Keep VINs, account data,
exact coordinates, tokens, secrets, and raw payloads out of reports.

## Collect a diagnostic window

1. From the repository root, start the standard stack if needed:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

   Then follow the API output:

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
4. Create or wait for a real vehicle update. Keep only redacted diagnostic
   lines and turn the switch off when the window is complete.

`Parallax envelope diagnostics` reports an allowlisted topic, outcome (`empty`,
`ignored`, `decoded`, or `rejected`), payload byte length, source age, and
canonical-forward result (`enqueued`, `stale`, `full`, `closed`, or no canonical
data). `vehicle ingestion diagnostics` reports source, field presence, and
sample age. `vehicle trip diagnostics` reports the selected power source and
age, numeric speed and origin, GNSS or odometer derivation reason and deltas,
trip category checks, start decision, and sanitized transition. These events
exclude payload and protobuf wire data, credentials, network identifiers, and
coordinates; they do include the existing vehicle ID, which must be redacted
before sharing.

## Symptom → next check

- Envelope outcome is `rejected`: check the topic and decoder/build version;
  the log intentionally omits payload bytes and decoder wire contents.
- Envelope outcome is `empty` or `ignored`: the frame had no usable canonical
  value or the topic has no stable canonical mapping. Unknown enum values do
  not become inferred states.
- Canonical-forward result is `stale`: compare the source age with the event
  time and check whether the update arrived outside the freshness window.
- Canonical-forward result is `full` or `closed`: inspect worker health and
  backpressure. Parallax collection keeps its independent persistence path.
- `vehicle trip diagnostics`: check the effective power source and freshness.
  Change-only Parallax power remains latched until a newer state arrives;
  periodic legacy `vehicleState` power is fresh for at most two minutes. Check
  that direct speed is used when present and that a GNSS or odometer estimate
  is used only when direct speed is absent.
- No topic or event: check Acquisition and upstream availability. A connected
  socket proves the subscription and heartbeat, not that a vehicle sent a
  particular topic.

## Exact-SHA real-drive acceptance

Decoder tests and a successful build establish code behavior. They do not prove
that a vehicle sent the expected signals or that a trip completed. Record the
full source Git SHA and immutable image digest for a controlled real-drive
check, then confirm the running API instance uses that build.

- [ ] Enable diagnostics for a non-demo vehicle and confirm fresh allowlisted
      state frames appear with bounded metadata.
- [ ] Capture a short, known drive safely. A passenger can observe the live
      dashboard; capture server logs only while stopped.
- [ ] Confirm recognized power and its source age are plausible: Parallax
      change-only state remains latched until an explicit new state, while
      periodic legacy power ages out after two minutes.
- [ ] Confirm reported numeric speed is preserved. When it is absent, check
      that any derived speed names its GNSS or odometer source and has plausible
      input deltas and interval.
- [ ] Confirm category checks and the trip start decision agree with the
      captured drive, followed by a sanitized start and completion transition.
- [ ] After stopping, confirm the trip closes and its distance is plausible.
      Save redacted evidence with the exact Git SHA and image digest.

If there is no real-vehicle capture from the identified build, record live
acceptance as unverified. Do not include vehicle IDs, VINs, coordinates, raw
payloads, or credentials in the evidence.

For the owner-facing overview, see [Extended Vehicle Telemetry](../guides/extended-vehicle-telemetry.md).
