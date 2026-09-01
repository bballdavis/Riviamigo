# Riviamigo product context

Riviamigo is a self-hosted web application for authenticated Rivian owners to understand vehicle telemetry, trips, charging, efficiency, health, and custom dashboards.

## Product priorities

- Dense operational information should remain calm, legible, and usable on desktop and mobile.
- Account-owned preferences follow the signed-in user across browsers and never rely on browser storage as authority.
- Shared seams own behavior across routes, dashboards, renderers, editors, and brand surfaces.
- Saved charts, bundled renderer ownership, dashboard geometry, favorites, and existing account behavior remain backward-compatible.
- Accessibility includes keyboard operation, focus management, contrast, forced-colors support, and usable 200% zoom layouts.

## Theme system constraints

- Appearance mode and theme selection are independent account settings.
- Classic is the compatibility default; RAD is an optional built-in visual direction.
- Built-in and private custom themes share one registry, runtime, chart palette, and asset resolver.
- Custom themes may override validated colors and trusted brand paint slots only. They cannot inject CSS, fonts, layout, motion, scripts, URLs, or arbitrary assets.
- Settings → Appearance is the only theme-selection surface. Theme Studio is a nested authoring experience for private custom themes.
- Documentation-site branding remains static Classic.

## Visual authority

The incumbent tokenized interface, shared primitives, `docs/branding.md`, and approved brand geometry are authoritative. Theme additions extend this system rather than replacing its interaction patterns or information architecture.
