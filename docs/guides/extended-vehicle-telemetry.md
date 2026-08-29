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
