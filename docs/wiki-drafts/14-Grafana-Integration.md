# Grafana Integration

Riviamigo exposes a SimpleJSON-compatible datasource endpoint at `/v1/grafana`, allowing you to use your Riviamigo instance as a Grafana datasource for custom dashboards, alerts, and long-term trend analysis.

> ⚠️ **Note:** The Grafana SimpleJSON endpoint is present in the router but currently returns `501 Not Implemented`. Full metric support is planned for a future release. This page documents the intended setup for when the feature ships. Check the GitHub releases page for availability.

---

## Prerequisites

- A running Grafana instance (self-hosted or Grafana Cloud).
- The [SimpleJSON plugin](https://grafana.com/grafana/plugins/grafana-simple-json-datasource/) installed in Grafana.
- A Riviamigo [API key](API-Keys) with access to your telemetry data.

### Installing the SimpleJSON plugin

In your Grafana instance:

```bash
grafana-cli plugins install grafana-simple-json-datasource
systemctl restart grafana-server   # or equivalent for your setup
```

Or via the Grafana UI: **Configuration → Plugins → Search "SimpleJSON"**.

---

## Adding the Datasource

1. In Grafana, go to **Configuration → Data Sources → Add data source**.
2. Search for and select **SimpleJSON**.
3. Configure:

   | Field | Value |
   |-------|-------|
   | Name | `Riviamigo` (or any label you prefer) |
   | URL | `http://your-riviamigo-host:3001/v1/grafana` |
   | Auth | **With Credentials**: off; **Custom Headers**: add `Authorization: Bearer rmigo_...` |

4. Click **Save & Test**. A green "Data source is working" message confirms the connection.

---

## Available Metrics

Once the Grafana integration is implemented, the following metrics are expected to be available (subject to change):

| Metric | Description |
|--------|-------------|
| `battery.soc` | Battery state of charge (%) over time |
| `battery.usable_kwh` | Usable battery capacity (kWh) |
| `odometer` | Cumulative odometer reading (miles) |
| `charge_rate_kw` | Instantaneous charge rate (kW) during sessions |
| `power_kw` | Drive power draw (kW) |
| `speed_mph` | Vehicle speed (mph) |
| `range_miles` | Estimated range (miles) as reported by the vehicle |

The exact metric names and available signals will be documented in the release notes when the feature ships.

---

## Example Dashboard Queries

Once connected, you can create panels like:

**Battery SoC over the last 7 days:**
- Metric: `battery.soc`
- Time range: Last 7 days
- Visualization: Time series

**Daily energy consumption:**
- Metric: `odometer`
- Function: derivative (to get daily distance delta)
- Visualization: Bar chart

---

## Troubleshooting

### "Data source is working" but no data appears

- Check that the time range in your Grafana panel includes dates when your vehicle was active.
- Verify the API key has not been revoked (Settings → API Keys in Riviamigo).

### 501 Not Implemented response

The Grafana endpoint has not been fully implemented yet. Check the [GitHub releases](https://github.com/YOUR_ORG/riviamigo/releases) for the version that ships Grafana support.

### Connection refused

- Verify `http://your-riviamigo-host:3001` is reachable from the Grafana server.
- If Grafana runs in Docker, use the container name or host network instead of `localhost`.

### CORS errors

The `/v1/grafana` path is exempt from CORS restrictions in the router. If you see CORS errors, they likely come from a reverse proxy misconfiguration — ensure your proxy forwards the `Authorization` header.
