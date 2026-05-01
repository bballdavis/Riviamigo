# Dashboard Authoring Guide

## Purpose

Use this guide when adding a dashboard, adding a widget, or extending dashboard editing behavior.

The main goal is to keep future work inside the shared dashboard seams instead of reintroducing route-level duplication.

## Before You Add Code

Decide which layer owns the change.

| Change | Put it here |
|---|---|
| New route path, URL params, route-local composition | `apps/web/src/routes` |
| Shared page scaffolding, edit flow, common actions | `apps/web/src/components/dashboard` |
| New dashboard widget or default config | `packages/dashboards/src` |
| New API query hook or response normalization | `packages/hooks/src` |
| Reusable chart, table, badge, primitive | `packages/ui/src` |

If the change crosses more than one row, start from the lowest reusable layer and move upward.

## Adding a Built-In Dashboard Page

1. Decide whether the page is mostly a dashboard grid or a custom detail page.
2. If it is a dashboard page, use the shared `DashboardPageShell` path instead of creating a new page scaffold.
3. Keep the route wrapper thin. It should only:
   - declare the path
   - read params or search state
   - pass explicit page composition pieces
4. If the page needs a hero panel, tabs, or a summary strip above the grid, render that through a page composition hook such as `renderBeforeDashboard` or a page-local wrapper component.
5. Seed or update the default dashboard config under `packages/dashboards/src/defaults/` and keep backend seeded JSON aligned where applicable.

## Adding a Widget

1. Add or reuse a hook in `packages/hooks/src`.
2. Add or reuse a reusable chart/table/card in `packages/ui/src` if the visual is generic.
3. Create the widget module in `packages/dashboards/src/widgets/`.
4. Register it via the existing widget barrel and registry.
5. Keep the widget focused on one concern.

A widget should usually:

- call one hook or a small related set of hooks
- map data into one visual or table
- avoid knowing about route params beyond the provided widget context

Do not use one widget to coordinate the rest of a page.

## Adding Page-Level Composition

Page-level composition is for content that should not live inside the dashboard grid.

Use it for:

- Overview hero content
- page-level tabs
- CTA banners
- detail summaries

Do not implement this by branching on dashboard slug inside the shell or renderer. Pass it in explicitly from the route or route-local wrapper.

## Editing Flow Rules

Default dashboards and user dashboards should share the same basic behaviors:

- edit mode
- save/cancel
- lock handling
- clone/customize
- import/export

If you need to change one of those flows, change the shared shell or the shared action wiring. Do not add a second implementation for one route family.

## Data and Adapter Rules

If several widgets on one page need shared derived data, create a page-specific hook or adapter instead of duplicating fetch logic in the route and widgets.

Good examples:

- an overview hook that returns live state, last drive, and last charge together
- a costs summary hook used by several cost widgets

Bad examples:

- multiple widgets each reimplementing the same response normalization
- route wrappers doing heavy transformation that should live in hooks

## File Placement Checklist

### New built-in dashboard page

- route file in `apps/web/src/routes/`
- optional page-local composition component in `apps/web/src/components/dashboard/` or a page-specific route folder
- default config in `packages/dashboards/src/defaults/`
- new widgets in `packages/dashboards/src/widgets/`
- new hooks in `packages/hooks/src/`

### New user-dashboard capability

- shared shell behavior in `apps/web/src/components/dashboard/`
- dashboard framework support in `packages/dashboards/src/`
- avoid putting framework behavior directly in `apps/web/src/routes/d.$slug.tsx`

## Review Checklist

Before merging dashboard frontend work, verify:

1. The route stayed thin.
2. Shared shell behavior was reused where possible.
3. No new slug-based branching was added to the shell or renderer.
4. Generic UI stayed in `packages/ui`.
5. Data access stayed in `packages/hooks`.
6. Default and user dashboards still follow the same edit/lock mental model.
7. Empty, loading, and error states still exist.

## When To Introduce a New Abstraction

Introduce a new shared abstraction only when at least two dashboards or routes need it.

Preferred order:

1. reusable UI primitive
2. reusable hook
3. shell-level composition prop
4. framework-level abstraction

Do not jump straight to a new framework primitive if a page-local component or hook is enough.