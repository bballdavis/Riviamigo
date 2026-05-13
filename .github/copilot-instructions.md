# Riviamigo Copilot Instructions

## Dashboard Frontend Boundaries

- Do not add old-version dashboard compatibility layers, outdated component names, or runtime shims. Riviamigo dashboards are developed against the current app schema; use one-time migrations or backfills when table/config shape changes are needed.
- Delete superseded dashboard widgets instead of preserving unused wrappers. If a widget is replaced by a reusable component type, remove the old module from the registry and from the codebase.
- Dashboard configs are composed from the current reusable component types: `custom`, `sensor`, and `chart`. Store per-instance values, options, and layout in dashboard config; keep reusable renderer behavior in code.
- Keep dashboard routes thin. Route files should declare path, params, search state, and mount shared dashboard composition.
- Reuse `apps/web/src/components/dashboard/DashboardPageShell.tsx` for dashboard page scaffolding instead of rebuilding layout, date range, edit state, or renderer wiring in route files.
- Keep `packages/dashboards/src/DashboardRenderer.tsx` focused on grid layout and widget hosting. Do not add page-specific business logic there.
- Keep widgets in `packages/dashboards/src/widgets/` small and focused. Avoid individual TSX wrappers for each sensor or chart when the same reusable component plus definitions/options can express the behavior.
- Keep dashboard API access and response normalization in `packages/hooks/src/`.
- Keep generic charts, tables, badges, and primitives in `packages/ui/src/` and free of page-specific fetch logic.
- Use the shared `ChartPicker` primitive above selectable charts: search input on the left quarter, chart dropdown on the right three quarters, full chart width, product-native labels, and no reference-product names in visible UI.
- Chart viewers should expose visible legends for multi-series or color-encoded charts. Prefer clickable legend series toggles when practical, and add brush or zoom controls for dense time-series charts.

## Composition Rules

- Page-specific content like the Overview hero, page-level tabs, CTA banners, and detail summaries belongs in explicit page composition, not in slug branches inside shared infrastructure.
- Do not introduce `if (slug === ...)` branching into the shared dashboard shell or renderer for page-only UI.
- Default dashboards and user dashboards should continue sharing the same edit, save, cancel, lock, clone, export, and import mental model.

## Authoring Rules

- When adding a new built-in dashboard, update the route wrapper, any needed hooks, widgets, and default dashboard config together.
- When changing a shared dashboard flow, update the shared shell or framework layer rather than patching only one route.
- Favor behavior-preserving extraction over broad redesign when cleaning up dashboard code.

## Color Tokens — Mandatory

All colors in component code must come from the design token system defined in `packages/ui/src/tokens/globals.css` and bridged via `apps/web/src/index.css`. Never write hex literals, `rgb()`/`rgba()`, named CSS colors, or arbitrary Tailwind color values (e.g. `accent-[#fb923c]`, `bg-[#1a1a1a]`).

- Use semantic Tailwind classes: `bg-bg-elevated`, `text-fg-tertiary`, `border-accent`, `text-status-positive`, etc.
- In inline styles or `<style>` blocks, use `var(--rm-*)` tokens. For opacity, use `color-mix(in oklab, var(--rm-accent) 50%, transparent)`.
- Form controls (range, checkbox) must use `accent-color: var(--rm-accent)` plus explicit track styling — never rely on browser default blue.
- If a color is missing from the token set, add a `--rm-*` token rather than inlining.

## References

- `docs/frontend/dashboard-architecture.md`
- `docs/frontend/dashboard-authoring.md`
