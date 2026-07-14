# Privacy

Riviamigo is designed so the dashboard, database, and backups live in infrastructure you operate. It does not include product analytics, tracking pixels, or telemetry sent to a Riviamigo-operated analytics service.

## What stays with your installation

Vehicle telemetry, account records, dashboards, and application data are stored in your Riviamigo database and any backup destination you configure. Rivian credentials are encrypted at rest using the installation's age key.

Your host, reverse proxy, identity provider, and backup provider have their own logs and retention policies. Configure them to match your privacy expectations.

## Requests to other services

Riviamigo still needs to communicate with services that make its features work:

- **Rivian:** account authentication, vehicle telemetry, and vehicle-artwork requests. Artwork is retrieved through the same encrypted account session, mirrored onto persistent local storage, and then served only from Riviamigo cache URLs or a local placeholder. The browser retrieves cache bytes through the existing authenticated Riviamigo API and never contacts Rivian artwork hosts directly.
- **Open-Meteo:** completed-drive weather enrichment. Riviamigo selects exact local route samples, then rounds provider coordinates to roughly 1 km by default, deduplicates them, randomizes their batch order, and sends the drive's UTC date span. Exact weather coordinates are an administrator option.
- **OpenStreetMap Nominatim:** explicitly submitted search text or exact reverse-geocoding coordinates. Accuracy requires exact input. Requests are sent by the Riviamigo server, cached, and throttled; public mode does not autocomplete.
- **CARTO basemap tiles:** exact tile coordinates reveal the requested map area. Tiles are fetched by an authenticated Riviamigo server proxy, so CARTO sees the server connection rather than each viewer's browser identity.
- **Iconify:** explicit icon searches and missing icon resources, through the Riviamigo server proxy.
- **Your configured S3-compatible backup service:** backup uploads, only when you enable it.

These are feature requests, not product analytics. Their operators may have their own privacy policies and server logs. **Settings > External Connections** shows the exact disclosure and feature loss for each service. Administrators can disable optional connections or use self-hosted weather, Nominatim, and XYZ tile endpoints. Disabling a connection preserves data already stored. The connection verifier uses synthetic payloads and stores its outcome separately from normal runtime health; it does not expose secrets or provider query strings.

Riviamigo does not forward browser cookies, authorization headers, referrers, usernames, vehicle names, VINs, or unrelated telemetry to optional providers. Connection-health logs do not store coordinates, addresses, search text, or provider query strings. Persistent address-search cache keys use a digest rather than storing the search text in Redis. Proxying removes unnecessary browser identity, but it cannot hide an exact address query or map area without breaking the requested feature.

## A practical reminder

Self-hosting gives you control; it does not make network traffic disappear. Keep Riviamigo behind authenticated access, secure your host and backups, and avoid sharing screenshots or logs that contain account details, locations, tokens, or vehicle data.
