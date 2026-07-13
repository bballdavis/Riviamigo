# Privacy

Riviamigo is designed so the dashboard, database, and backups live in infrastructure you operate. It does not include product analytics, tracking pixels, or telemetry sent to a Riviamigo-operated analytics service.

## What stays with your installation

Vehicle telemetry, account records, dashboards, and application data are stored in your Riviamigo database and any backup destination you configure. Rivian credentials are encrypted at rest using the installation's age key.

Your host, reverse proxy, identity provider, and backup provider have their own logs and retention policies. Configure them to match your privacy expectations.

## Requests to other services

Riviamigo still needs to communicate with services that make its features work:

- **Rivian:** account authentication and vehicle telemetry requests.
- **Open-Meteo:** trip-start weather enrichment when that feature runs; the request can include trip coordinates and time.
- **OpenStreetMap Nominatim:** place lookup or reverse geocoding for trip context; the request can include a location.
- **Carto basemap tiles:** map tiles loaded while viewing trip maps; tile requests can reveal an approximate map area and the viewer's network address to that provider.
- **Your configured S3-compatible backup service:** backup uploads, only when you enable it.

These are feature requests, not product analytics. Their operators may have their own privacy policies and server logs. If a particular external request is not acceptable for your installation, avoid the corresponding feature or host the supporting service yourself where possible.

## A practical reminder

Self-hosting gives you control; it does not make network traffic disappear. Keep Riviamigo behind authenticated access, secure your host and backups, and avoid sharing screenshots or logs that contain account details, locations, tokens, or vehicle data.
