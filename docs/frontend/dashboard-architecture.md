# Dashboard Frontend Architecture

## Purpose

Riviamigo dashboards will keep growing. The frontend needs one maintainable composition model instead of multiple route-specific implementations that each re-own layout, date range, edit state, and dashboard actions.

This document defines the approved layering for dashboard work and the package boundaries that keep the system maintainable.

## Design Goals

- Keep one shared code path for default dashboards and user dashboards.
- Keep routes thin.
- Keep the dashboard renderer focused on layout, not page composition.
- Keep widgets small and reusable.
- Make non-grid page sections explicit instead of implicit slug-based hacks.

## Current Anchors

- Shared page shell: `apps/web/src/components/dashboard/DashboardPageShell.tsx`
- Built-in dashboard wrapper: `apps/web/src/components/dashboard/DashboardPage.tsx`
- User dashboard route: `apps/web/src/routes/d.$slug.tsx`
- Dashboard renderer: `packages/dashboards/src/DashboardRenderer.tsx`
- Widget registry: `packages/dashboards/src/registry.tsx`
- Dashboard defaults and persistence helpers: `packages/dashboards/src/api.ts`, `packages/dashboards/src/defaults/`

## Approved Layering

### 1. Route Layer

Route files should do only the following:

- declare path, params, and search state
- mount the protected-route wrapper for authenticated dashboard pages
- mount a shared dashboard shell or route-local page component
- pass explicit page composition hooks such as hero panels or tabs

Route files should not directly recreate dashboard scaffolding that already exists in the shared shell.

### 2. Page Shell Layer

`DashboardPageShell` is the shared page scaffold. It owns:

- app layout and page layout
- dashboard config fetch with fallback to bundled defaults
- date range state
- edit/view mode state
- local working config state
- rendering of common actions around the dashboard

If a new dashboard page needs standard dashboard behavior, start here instead of creating a second scaffold.

Authenticated route entrypoints own the auth boundary. They should mount the shared protected-route wrapper before any dashboard page component so protected hooks cannot fire during auth bootstrap or stale-session recovery.

### 3. Page Composition Layer

Page-specific sections that sit above or beside the grid belong in page composition, not in the renderer.

Examples:

- Overview hero panel
- page-level tabs
- detail summary strips
- page-specific CTAs

Use explicit composition slots such as `renderBeforeDashboard` or a page-local wrapper component. Do not add slug checks to the shell or renderer for page-specific UI.

### 4. Dashboard Framework Layer

`packages/dashboards` owns the reusable dashboard framework:

- schema and validation
- widget registry
- grid renderer
- dashboard CRUD helpers
- YAML import and export
- bundled default dashboard configs

This package should stay framework-focused. It should not accumulate page-specific business rules.

### 5. Widget Layer

Widgets belong in `packages/dashboards/src/widgets`.

Each widget should:

- represent one dashboard unit
- call its own hook(s)
- render generic UI from `@riviamigo/ui`
- avoid coordinating unrelated page sections

If multiple widgets need shared derived data, move that derivation to a hook or adapter instead of coupling the widgets together.

#### Chart widget display settings

The shared chart widget owns reusable chart display controls.

- Persist chart display settings per chart ID inside widget `options.chartSettings`, not as route-local state.
- Keep legacy `curveSmoothing` read compatibility, but write new edits through the per-chart settings map.
- Treat dashboard edit mode as the only persistent write seam. In edit mode, widget-level settings changes should flow back through the dashboard shell's local config update path. In view mode, the same UI can preview changes locally, but those changes should not autosave.
- Keep the settings UI inside the shared chart widget and shared chart primitives. Do not recreate chart-settings popovers in route files or page components.
- Rich time-series charts may expose manual `y` and `y2` ranges broadly, but `x` range controls are only valid when the chart owns its own non-dashboard domain.
- When a chart follows the shared dashboard timeframe, the page shell remains the source of truth for the X domain. Do not expose per-widget time-range overrides that conflict with `DashboardPageShell`.

### 6. Hooks and Data Layer

`packages/hooks` owns dashboard-facing data access and lightweight normalization.

Use hooks for:

- endpoint access
- response normalization
- cache keys
- page-level aggregate fetches that several widgets share

Do not put route orchestration into generic widgets. If a page needs multiple coordinated requests, create a page-specific hook or adapter and keep the widget inputs simple.

### 7. Reusable UI Layer

`packages/ui` owns reusable primitives, charts, and tables.

This package should not make page-specific API decisions. It should stay data-shape driven and reusable across dashboards.

## Package Ownership

| Concern | Owning package/path | Notes |
|---|---|---|
| Route params, search state, page wiring | `apps/web/src/routes` | thin wrappers only |
| Shared dashboard page scaffold | `apps/web/src/components/dashboard` | owns shell behavior |
| Dashboard schema, defaults, renderer, registry | `packages/dashboards/src` | framework layer |
| Dashboard data fetching and normalization | `packages/hooks/src` | query layer |
| Generic charts, tables, badges, primitives | `packages/ui/src` | reusable presentation layer |

## Approved File Structure

```text
apps/web/src/components/dashboard/
  DashboardPageShell.tsx      # shared scaffold
  DashboardPage.tsx           # built-in dashboard wrapper

apps/web/src/routes/
  index.tsx                   # Overview route wrapper
  battery.tsx                 # built-in route wrapper
  charging.tsx                # built-in route wrapper
  efficiency.tsx              # built-in route wrapper
  trips.tsx                   # built-in route wrapper
  d.$slug.tsx                 # user dashboard route wrapper

packages/dashboards/src/
  schema.ts                   # config schema
  registry.tsx                # widget definitions
  DashboardRenderer.tsx       # grid rendering only
  widgets/                    # widget modules
  defaults/                   # bundled defaults
  api.ts                      # dashboard CRUD helpers

packages/hooks/src/
  api.ts                      # HTTP wrappers
  use*.ts                     # dashboard-facing hooks

packages/ui/src/
  charts/
  tables/
  primitives/
```

## Rules

### Do

- keep dashboard routes declarative
- put shared edit/view/dashboard state in the shell
- keep renderer layout-only
- compose page extras explicitly
- reuse `packages/ui` before creating page-local visuals
- reuse `packages/hooks` before embedding fetch logic in route wrappers

### Do Not

- add `if (slug === ...)` branching inside the shared shell for page-only content
- add direct page composition logic to `DashboardRenderer`
- duplicate edit, clone, export, import, or lock handling in a second route scaffold
- put page-specific API calls inside `packages/ui`
- use widgets as a substitute for page-level orchestration when several widgets need shared context

## Next Structural Step

The current shell is the first stabilization step. If the number of built-in dashboards keeps growing, the next evolution should be a lightweight page-definition layer so routes declare metadata instead of assembling custom wrapper logic repeatedly.
