# Rivian Account Setup

This page explains how to connect your Rivian account to Riviamigo and what to expect during setup.

---

## How It Works

Riviamigo uses the same unofficial API that the Rivian mobile app uses. You do not need a developer account or API key from Rivian — just your normal Rivian login credentials.

> **Note:** Because this is an unofficial API, it can change without notice when Rivian releases app updates. If something breaks after a Rivian update, check the GitHub issues page.

Your Rivian credentials are stored **age-encrypted** (X25519) in the local database. The encryption key is stored in your database's `system_config` table, auto-generated on first boot. Credentials never leave your server.

---

## Adding Your Vehicle

1. Log in to Riviamigo and navigate to **Settings → Vehicles**.
2. Click **Add Vehicle**.
3. Enter your Rivian account **email address** and **password**.
4. Riviamigo initiates the auth flow with Rivian's servers. Rivian sends a **one-time passcode (OTP)** to your registered phone number.
5. Enter the OTP in the Riviamigo UI when prompted.
6. If authentication succeeds, your credentials are encrypted and stored. The vehicle connection supervisor starts immediately.

Allow about 30 seconds for the first telemetry poll. If the vehicle is asleep (e.g., in a garage and idle), the initial data may take a few minutes to appear.

---

## What Data Is Collected

Riviamigo collects the following from Rivian's API:

- **Telemetry** — battery state of charge, location, speed, power draw, climate settings, odometer, and other signals pushed via WebSocket.
- **Charge sessions** — start/end time, energy delivered, charge rate.
- **Trip records** — start/end time, distance, energy consumption.

Riviamigo does **not** collect:
- Payment methods or financial data.
- Personal information beyond what is needed to authenticate with Rivian (email address).
- Service records or warranty data (not exposed by Rivian's current API).

---

## Telemetry Polling Behavior

Riviamigo uses two methods to keep data current:

1. **WebSocket subscription** — real-time pushes from Rivian's GraphQL subscription endpoint. This is the primary method.
2. **Adaptive poll loop** — periodic follow-up work that reconciles completed charging sessions with Rivian's charging history, captures live charging curve samples while a session is active, and keeps metadata like charge costs/vendor information catching up even after the live telemetry event has ended.

The supervisor restarts the WebSocket connection automatically with **exponential backoff** if it disconnects. In addition, each per-vehicle worker carries a watchdog that restarts a collector if the Rivian WebSocket stays connected but stops delivering messages, which helps recover from silent stalls without manual intervention.

---

## Troubleshooting

### Vehicle shows as offline or data is stale

- Check the API logs: `docker compose logs -f api`
- Look for `[ingestion]` log lines showing reconnect attempts or watchdog restarts.
- If you see repeated auth failures, your Rivian session may have expired. Go to **Settings → Vehicles**, delete the vehicle, and re-add it.

### OTP not received

- Check that the phone number on your Rivian account is current.
- Rivian sends OTPs by SMS. If you changed phone numbers, update your Rivian account first.

### Multiple vehicles

Each vehicle is managed independently. Add each vehicle separately via **Settings → Vehicles → Add Vehicle**. Each vehicle gets its own WebSocket connection.

### Rivian API changes

Rivian does not publish an official API, so the integration may break after Rivian app updates. If you see consistent auth or WebSocket errors after a Rivian app update, check:

- The Riviamigo GitHub issues page for reported breakage.
- The [Home Assistant Rivian integration](https://github.com/nickcoutsos/homeassistant-rivian) for upstream API shape changes (Riviamigo tracks a similar API).

---

## Removing a Vehicle

Go to **Settings → Vehicles**, find the vehicle, and click **Delete**. This removes the vehicle's credentials from the database and stops the telemetry connection. Historical data is retained unless you manually delete it from the database.
