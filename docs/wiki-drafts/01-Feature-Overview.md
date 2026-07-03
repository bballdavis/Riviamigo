# Feature Overview

Riviamigo is a self-hosted Rivian telemetry dashboard that gives you full ownership of your vehicle data. This page summarizes what the platform can do today and what infrastructure it relies on.

---

## Telemetry and Vehicle Monitoring

- **Real-time vehicle status** — live location, battery state of charge, charge state, climate settings, and drive statistics streamed via Rivian's WebSocket API.
- **Historical telemetry charts** — browse any signal (speed, SoC, power draw, etc.) over a configurable date range.
- **Battery health tracking** — monitor usable capacity and degradation trends over time using raw telemetry from `timeseries.telemetry`.

## Charging

- **Charging history** — every charge session is recorded with start/end time, kWh delivered, peak charge rate, and duration, with recent completed sessions re-reconciled against Rivian's charging history so vendor and paid-total fields can land after the live telemetry window closes.
- **Charge rate curves** — per-session charging curves using 1-minute continuous aggregates (`timeseries.telemetry_1min`), with a session-aware fallback to saved Rivian charge points when older telemetry is sparse and a smoothed trend instead of a straight regression.
- **Time-of-Use (TOU) cost profiles** — define electricity pricing by time of day and day of week with effective-date ranges so historical costs stay accurate after rate changes.

## Trips

- **Trip history** — individual trip records with distance, energy consumption, and efficiency metrics.
- **Efficiency metrics** — miles per kWh and other derived stats computed from telemetry data.

## Dashboards

- **Customizable dashboards** — drag-and-drop widget layout, multiple dashboard support.
- **Widget types** — sensor chips (stat cards), time-series charts, and custom components.
- **Dashboard import/export** — share or back up dashboard configurations as JSON.
- **Edit/view mode** — lock dashboards to prevent accidental edits; clone built-in dashboards before customizing.

## Integration and Access

- **API key support** — create `rmigo_`-prefixed API keys for programmatic access or third-party integrations.
- **Grafana datasource** — Riviamigo exposes a SimpleJSON-compatible endpoint at `/v1/grafana` for use with Grafana's SimpleJSON plugin.
- **Typed REST API** — all data is available via a versioned REST API (`/v1/...`) for building custom tooling.

## Operational

- **Self-hosted** — runs entirely on your hardware via Docker Compose. No data leaves your network unless you configure external S3 backups.
- **TimescaleDB storage** — PostgreSQL with the TimescaleDB extension provides efficient time-series compression, continuous aggregates, and retention policies.
- **Docker Compose deployment** — single-command startup for the full stack (API, web, database, Redis, optional Garage S3).
- **Maintenance log** — track service events and maintenance history for your vehicle.

## Security

- **JWT authentication** — RS256 access tokens (15-minute lifetime) with HttpOnly refresh cookies (30-day lifetime).
- **age encryption** — Rivian credentials stored at rest using age X25519 encryption.
- **Rate limiting** — built-in rate limiting on all endpoints to protect against abuse.

---

> **Note:** The Grafana datasource endpoint is present in the router but returns 501 Not Implemented in the current release. Full Grafana metric support is planned for a future release.
