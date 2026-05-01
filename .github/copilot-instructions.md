# Riviamigo Copilot Instructions

## Dashboard Frontend Boundaries

- Keep dashboard routes thin. Route files should declare path, params, search state, and mount shared dashboard composition.
- Reuse `apps/web/src/components/dashboard/DashboardPageShell.tsx` for dashboard page scaffolding instead of rebuilding layout, date range, edit state, or renderer wiring in route files.
- Keep `packages/dashboards/src/DashboardRenderer.tsx` focused on grid layout and widget hosting. Do not add page-specific business logic there.
- Keep widgets in `packages/dashboards/src/widgets/` small and focused. If several widgets need shared derived data, create a hook or page adapter instead of coupling the widgets together.
- Keep dashboard API access and response normalization in `packages/hooks/src/`.
- Keep generic charts, tables, badges, and primitives in `packages/ui/src/` and free of page-specific fetch logic.

## Composition Rules

- Page-specific content like the Overview hero, page-level tabs, CTA banners, and detail summaries belongs in explicit page composition, not in slug branches inside shared infrastructure.
- Do not introduce `if (slug === ...)` branching into the shared dashboard shell or renderer for page-only UI.
- Default dashboards and user dashboards should continue sharing the same edit, save, cancel, lock, clone, export, and import mental model.

## Authoring Rules

- When adding a new built-in dashboard, update the route wrapper, any needed hooks, widgets, and default dashboard config together.
- When changing a shared dashboard flow, update the shared shell or framework layer rather than patching only one route.
- Favor behavior-preserving extraction over broad redesign when cleaning up dashboard code.

## References

- `docs/frontend/dashboard-architecture.md`
- `docs/frontend/dashboard-authoring.md`