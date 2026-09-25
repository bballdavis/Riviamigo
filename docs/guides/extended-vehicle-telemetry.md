---
title: Extended Vehicle Telemetry
description: Enable Rivian-reported connectivity, efficiency, mass, and parked-energy readings.
---

# Extended Vehicle Telemetry

Riviamigo runs an integrated, isolated Parallax acquisition subsystem inside each vehicle worker. It adds
privacy-filtered vehicle readings to the compact Connectivity and Signal
Freshness panels at the top of Health, plus a Rivian-reported Parked Energy
breakdown to Phantom Drain.

The subsystem ships as part of the normal API process. It
uses its own WebSocket, persistence path, reconnect loop, health state, and
bounded lease, so failure cannot block canonical vehicle acquisition. Set
`PARALLAX_ENABLED=false` only as an emergency rollback; no separate container
or launcher is required.

The Parked Energy card distinguishes the two available perspectives:

- **Rivian reported:** vehicle-calculated energy attributed to vehicle systems,
  climate, Gear Guard, and outlets.
- **Riviamigo battery-change estimate:** the existing calculation from
  validated parked-session battery and range changes.

The two sources are displayed separately because their windows and measurement
methods differ. Riviamigo does not silently substitute one for the other.

Health keeps the integrated acquisition state visible in the compact top panels, including
never-observed, starting, connected, reconnecting, stale, disabled,
duplicate-owner, and error states. The Health summary includes vehicle Wi-Fi,
unit-aware estimated efficiency, unit-aware vehicle mass, optional cold-weather
impact, and acquisition diagnostics. The Connectivity panel presents
Connectivity as separate Wi-Fi signal, throughput, and Wi-Fi status metrics.
Acquisition is the integrated Parallax subsystem's separate Rivian GraphQL WebSocket state:
Connected means its handshake, subscription, and heartbeat are active, while
Error means its latest token, socket, subscription, or heartbeat attempt
failed and will be retried. Error does not by itself indicate a vehicle fault
or canonical telemetry failure; the Health info tooltip explains this alongside
the latest frame and diagnostic counts.
Legacy charging-session and repair-journal details are not part of that compact
summary. When Parallax acquisition is unavailable,
canonical telemetry and Riviamigo's derived Phantom Drain history continue
normally.

Connectivity collection excludes network names and hardware identifiers.
Values such as mass and learned efficiency are labeled as Rivian estimates,
not independently measured specifications.

## R2 readings and trips

For a connected R2, the Parallax subscription also requests power, GNSS,
odometer, closures and locks, tire state, and cabin readings. Validated readings
join the ordinary vehicle status and telemetry history. A missing field stays
missing; availability depends on what the vehicle and Rivian send. Parallax
readings do not start or end charging sessions.

R2 trips can be assembled from sparse updates. Riviamigo joins a recent power
state to a location fix and, when no speed is reported, estimates speed from
successive plausible fixes. It requires two moving segments before using that
estimate to detect motion. Old fixes, implausible jumps, and stale power are
discarded for trip detection. Stored source readings are not rewritten with the
estimated speed.

## Investigate missing readings

1. Open **Health** for the vehicle. Check Acquisition separately from canonical
   feed health. A connected acquisition means the Parallax socket is active;
   it does not guarantee that Rivian has sent every requested topic.
2. In **Settings → Raw data**, an owner or manager can enable **Ingestion
   diagnostics** for a non-demo vehicle linked to a Rivian account. The switch
   automatically expires after one hour. Demo vehicles cannot enable it.
3. Watch the API process logs while a relevant vehicle update occurs. The
   `vehicle ingestion diagnostics` event reports source, field presence, and
   sample age. The `vehicle trip diagnostics` event reports whether recent
   power or derived speed was used and whether a trip transitioned. A rejected
   typed Parallax frame reports its topic and decoder reason.
4. Compare those events with the Health acquisition status and the collector
   diagnostics in **Settings → Raw data**. No incoming topic points toward
   upstream availability or connection state. An incoming topic with a decoder
   rejection points toward a schema or value mismatch. A valid sparse fix with
   no trip can be expected until enough recent motion samples arrive.
5. Turn the switch off after collecting enough evidence. Expiry also turns it
   off automatically. The switch controls diagnostic logging; it does not
   enable or disable telemetry collection.

Diagnostic events omit raw Parallax payloads, credentials, network identifiers,
and coordinates. They are written to the API's configured logs, so log
retention is controlled by the host. A sleeping vehicle may provide no new
frames during the one-hour window. See the [maintainer runbook](../runbooks/r2-ingestion-diagnostics.md)
for a repeatable investigation and the [API reference](../api-access.md) for
the session-only switch endpoints.
