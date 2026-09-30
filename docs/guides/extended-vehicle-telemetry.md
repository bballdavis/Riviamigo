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

R2 trips can be assembled from sparse updates. The R2 reports its power state
only when it changes, so Riviamigo treats the latest reported state (for
example Go) as current until the vehicle reports another one. When no speed is
reported, Riviamigo estimates it from successive plausible location fixes
(after two moving segments) or from odometer increases a few minutes apart.
When location fixes show no movement yet but the odometer on the same update
has increased, the odometer estimate is used. A speed the vehicle reports
itself is never replaced. A trip's distance starts from the odometer reading taken when the vehicle
shifted into gear, so the first odometer steps of a drive are not lost. Old
fixes, implausible jumps, and parked odometer readings are discarded for trip
detection. Stored source readings are not rewritten with the estimated speed.

## Investigate missing readings

Use this short procedure when a maintainer asks for evidence about a missing
reading:

1. From the repository root, start the standard stack if it is stopped, then
   follow the existing API output:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   docker compose --env-file .env -f compose/docker-compose.yml logs -f riviamigo
   ```

   Use the equivalent log command for your deployment if it is managed by an
   operator. Normal API startup runs the in-process Parallax acquisition task;
   there is no separate Parallax logger, container, or start command.
2. In **Settings → Raw data**, an owner or manager turns on **Ingestion
   diagnostics** for the affected non-demo vehicle. It expires after one hour.
   The switch increases diagnostic log detail; it does not enable ingestion or
   create a downloadable data dump.
3. Create or wait for a real vehicle update while the logs are being followed.
   The `vehicle ingestion diagnostics` event records source, field presence,
   and sample age. The `vehicle trip diagnostics` event records power joining,
   derived speed, and trip transitions. Health **Acquisition** and **Collector
   diagnostics** provide the connection and decoder context.
4. Share only redacted diagnostic lines. Remove vehicle IDs, account data,
   coordinates, tokens, secrets, and any other identifying values. Do not share
   raw telemetry payloads.
5. Turn **Ingestion diagnostics** off when the evidence is collected. It also
   expires automatically after one hour.

Diagnostic events omit raw Parallax payloads, credentials, network identifiers,
and coordinates; host logging controls retention. A sleeping vehicle may provide
no new frames during the window. See the [maintainer runbook](../runbooks/r2-ingestion-diagnostics.md)
for a repeatable investigation and the [API reference](../api-access.md) for
the session-only switch endpoints.
