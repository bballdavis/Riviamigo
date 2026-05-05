---
description: "Use when creating or refactoring Riviamigo dashboard pages, dashboard widgets, dashboard editing flows, or dashboard-specific frontend hooks. Covers route/page-shell boundaries, package ownership, and maintainable dynamic dashboard composition."
name: "Dashboard Frontend Boundaries"
applyTo:
  - "apps/web/src/components/dashboard/**"
  - "packages/dashboards/src/**"
  - "docs/frontend/**"
---
# Dashboard Frontend Boundaries

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
