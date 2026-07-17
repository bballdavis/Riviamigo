---
title: External connections
description: Configure weather, geocoding, basemap, proxy, privacy, and self-hosted providers.
slug: /using-riviamigo/external-connections/
---

# External connections

Open **Settings > External Connections** to see every service Riviamigo may contact. All signed-in users can read the inventory and its data disclosures. Administrators and super users control the installation-wide policy.

Riviamigo does not send product analytics. These connections exist only to provide a feature you request. Each card shows the destination, data sent, last sanitized result, daily request count, and what stops if the connection is disabled. **Disable optional** stops weather, geocoding, basemaps, and remote icon catalog access without deleting stored results.

## Weather and outside temperature

Rivian's usable vehicle-state subscription currently provides cabin and driver-set temperatures but rejects its exterior-temperature field. Riviamigo therefore estimates exterior temperature after a drive using Open-Meteo.

- The drive start, end, and each 15-minute point are selected from the exact local route.
- Provider coordinates are rounded to roughly 1 km by default, deduplicated, shuffled, and sent in batches of up to 50 locations.
- Exact route points and timestamps stay in Riviamigo. Returned hourly temperatures are mapped back to the local timeline.
- Trips less than five days old use the forecast endpoint; older trips use the archive endpoint.
- The trip summary is a time-weighted average. The same value powers the trip timeline, average-outside-temperature card, and efficiency temperature buckets.
- Stored samples say whether values came from `vehicle`, `open_meteo`, or both. If Rivian supplies a raw exterior value in the future, it wins at covered times.

Remote Open-Meteo is enabled on upgrade to preserve existing behavior. Administrators can choose a custom forecast and archive URL, add a write-only encrypted API key, select exact weather coordinates, or disable weather. Disabling weather pauses queued jobs and preserves history. An Open-Meteo-compatible endpoint is the supported self-hosted contract.

## Geocoding

Public mode sends exact coordinates or explicitly submitted search text to Nominatim through the Riviamigo server. Exact values are necessary for accurate addresses. Riviamigo checks saved places and cached results first, identifies itself with a static project User-Agent, and limits public requests to one per second. The public service is never queried on every keystroke.

A custom or self-hosted Nominatim base URL can optionally enable debounced autocomplete. The custom selector includes the standard Nominatim-compatible contract and a local Nominatim example; it still uses the normal `/search` and `/reverse` paths. Disabling geocoding stops new searches and automatic trip labels; coordinates, saved places, and cached labels remain.

## Basemaps

Trip geometry remains exact. CARTO tiles are requested through an authenticated Riviamigo proxy, so the tile provider sees the requested map area and the server connection, not each viewer's browser identity. Custom XYZ raster templates require `{z}`, `{x}`, and `{y}`, attribution, and may include an encrypted bearer token. A missing dark template falls back to the light template.

Choosing **Disabled** keeps the route on a neutral background. Custom XYZ raster tile servers are supported, including TileServer GL-compatible raster templates; the selector provides a TileServer GL local example. HTTP is accepted only for an explicitly confirmed local/private endpoint.

## Local provider caches

Riviamigo keeps a persistent local cache for basemap tiles and address-search results. Reopening a map or repeating an address search uses the local cache instead of contacting the provider again. Reverse-geocoded address records are also stored in the database and survive restarts.

The selected connection shows its entry count and storage use. Administrators can use **Purge cache** when a provider changes data or storage needs to be reclaimed. Purging map tiles means the next view may request a tile again. Purging Nominatim removes lookup-only address records and search results, while preserving addresses attached to trips, charge sessions, or saved places.

## Other connections

- **Iconify:** catalog searches and runtime icon files use the Riviamigo proxy. Disabling it preserves bundled icons and existing supported selections.
- **S3-compatible backups:** status is shown here, while endpoint and credential controls remain in **Settings > Backups**.
- **Rivian account:** vehicle connectivity and artwork remain managed from **Settings > Vehicles**. Rivian-provided artwork is fetched with the same encrypted account session used for telemetry, stored on Riviamigo's persistent API data volume, and served only from first-party cache URLs. A failed or missing cache file shows the local placeholder and is repaired in the background; it never causes the browser to request a Rivian image URL. Administrators can use **Refresh vehicle artwork** from the vehicle card to fetch a new manifest and invalidate immutable image URLs.

## Custom endpoint safety

Custom endpoints accept HTTPS. HTTP is restricted to confirmed local/private destinations. Riviamigo rejects executable and file schemes, link-local and cloud-metadata addresses, validates DNS destinations, does not follow redirects, bounds proxy responses, and never returns stored secrets to the browser. Connection logs omit coordinates, addresses, search text, query strings, credentials, VINs, and vehicle names.

## Verify a connection

Use **Test with synthetic data** before relying on a provider. The result is separate from runtime health, so testing an unsaved endpoint never overwrites the installed provider's last-success record. Each result shows named checks and safe messages; it uses a generic location, map tile, or icon name rather than a real drive.

For a release or a new self-hosted endpoint, verify every enabled connection, then inspect a signed-in browser's network panel. Browser requests should target only Riviamigo's same-origin basemap and Iconify proxy paths. A tile failure switches the map to a neutral recovery state with a retry action; it must not leave a blank interactive map.
