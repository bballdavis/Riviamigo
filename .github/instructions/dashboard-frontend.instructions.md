---
description: "Use when creating or refactoring Riviamigo dashboard pages, dashboard widgets, dashboard editing flows, or dashboard-specific frontend hooks. Covers route/page-shell boundaries, package ownership, and maintainable dynamic dashboard composition."
name: "Dashboard Frontend Boundaries"
applyTo:
  - "apps/web/src/components/dashboard/**"
  - "packages/dashboards/src/**"
  - "docs/frontend/**"
---
# Dashboard Frontend Boundaries

- Do not add old-version dashboard code, compatibility shims, or runtime transforms. Backfill/migrate dashboard config or DB shape when needed, then keep the app on the current schema.
- Remove superseded dashboard modules instead of preserving unused wrappers. New sensor/chart behavior should be expressed through definitions/options and the shared component type, not one TSX component per chip or chart.
- Dashboard configs should use the current reusable component model: `custom`, `sensor`, and `chart`. Store layout and instance options in config; store reusable renderer behavior in code.
- Routes should stay declarative. Prefer mounting shared dashboard composition over recreating layout, date range, and edit state per route.
- Shared dashboard page behavior belongs in `apps/web/src/components/dashboard/DashboardPageShell.tsx`.
- `packages/dashboards/src/DashboardRenderer.tsx` should remain layout-only. Do not add route-specific UI or slug-based behavior there.
- Widgets belong in `packages/dashboards/src/widgets/` and should stay focused on one concern.
- Shared dashboard data access belongs in `packages/hooks/src/`, not in route wrappers or `packages/ui` components.
- Generic visual components belong in `packages/ui/src/` and should not perform page-specific API orchestration.
- For chart selection controls, use the shared `ChartPicker` pattern above the chart: a full-width control row with a search field in the first quarter and the chart dropdown in the remaining three quarters. Keep labels product-native and do not mention reference products in UI copy.
- Chart viewers should show a legend when multiple series or encoded colors are present. Where the charting component supports it, legends should allow series toggling, and dense time-series charts should expose brush or zoom controls.
- Use explicit page composition for hero panels, tabs, summary strips, and CTA banners. Do not hide these behind `if (slug === ...)` branches in shared infrastructure.
- When a change affects default dashboards and user dashboards, prefer updating the shared shell or framework so both paths remain aligned.
- Before adding a new abstraction, check whether a reusable hook or page-local composition component is sufficient.

## Color Tokens — Mandatory

All colors in component code must use the design token system. Never write a hex literal (`#1a1a1a`), `rgb()`/`rgba()`, named CSS color, or arbitrary Tailwind value (`accent-[#fb923c]`) in component or style code.

- **Tailwind utilities**: Use semantic Tailwind classes (`bg-bg-elevated`, `text-fg-tertiary`, `border-accent`, `text-status-positive`, etc.) that resolve through the `@theme inline` bridge in `apps/web/src/index.css`.
- **CSS custom properties**: When writing inline `style={}` or `<style>` blocks, use `var(--rm-*)` tokens directly (e.g. `var(--rm-accent)`, `var(--rm-bg-elevated)`). Use `color-mix()` for opacity variants: `color-mix(in oklab, var(--rm-accent) 50%, transparent)`.
- **Form controls** (range sliders, checkboxes): Set `accent-color: var(--rm-accent)` and provide explicit track/thumb styling using token values — never rely on the browser default blue.
- **Missing shades**: If a needed color isn't in the token set, add a new `--rm-*` token to `packages/ui/src/tokens/globals.css` and bridge it in `index.css` rather than inlining.
- **Pre-PR check**: Grep for `#[0-9a-fA-F]{3,8}`, `rgb(`, `rgba(`, and Tailwind `*-blue-*`/`*-indigo-*`/`*-sky-*`/`*-violet-*` classes in changed files. Any hit is a bug.
