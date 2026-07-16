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
- View grid: `packages/dashboards/src/DashboardGrid.tsx`
- Shared widget chrome: `packages/dashboards/src/WidgetChrome.tsx`
- Dashboard model helpers: `packages/dashboards/src/dashboardModel.ts`
- Conditional visibility registry: `packages/dashboards/src/dashboardVisibility.ts`
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
- edit/view mode state through `useDashboardEditDraft`
- dashboard-scoped local working config state
- rendering of common actions around the dashboard
- visible save-error feedback while edits remain open

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
- dashboard model helpers for identity, ownership, layout patches, and view-only widget visibility
- a typed visibility-rule registry that owns condition labels, preview values, and runtime resolution
- view grid renderer
- edit grid renderer
- shared widget chrome and edit overlay
- dashboard CRUD helpers
- YAML import and export
- bundled default dashboard configs, authored once in `packages/dashboards/src/defaults/` and generated into API seed files with `pnpm dashboards:sync-defaults`

This package should stay framework-focused. It should not accumulate page-specific business rules.

Conditional widgets use `WidgetInstance.visibility`. Rules are evaluated with AND semantics, and widgets without rules are always visible. The first registered condition is `vehicle-connection`, with `plugged` and `unplugged` values. Connected standby counts as plugged. Add future condition families to `dashboardVisibility.ts`; do not add slug, route, or widget-definition branches to the renderer.

In view mode, `DashboardRenderer` resolves visibility from live status. In edit mode it owns a temporary, named scenario preview state, filters both the canvas and dashboard-wide data requirements to preview-visible widgets, and keeps the complete draft in `GridEditor`. The editor drawer presents the active scenario prominently, for example `Previewing: Vehicle plugged in`, and lets the user switch between registered condition values. Preview state never persists or enters the dashboard schema. Legacy `options.chargingConnectionVisibility` values are normalized to typed rules at API/import boundaries and are written in the typed form on the next save.

### 5. Widget Layer

Widgets belong in `packages/dashboards/src/widgets`.

Each widget should:

- represent one dashboard unit
- declare the data it needs through `WidgetDef.dataRequirements` when it can use a dashboard-wide source or metric batch
- render generic UI from `@riviamigo/ui`
- avoid coordinating unrelated page sections

If multiple widgets need shared derived data, move that derivation to a hook or adapter instead of coupling the widgets together.

#### Chart widget display settings

The shared chart widget owns reusable chart display controls.

- Persist chart display settings per chart ID inside widget `options.chartSettings`, not as route-local state.
- Keep legacy `curveSmoothing` read compatibility, but write new edits through the per-chart settings map.
- Treat dashboard edit mode as the only persistent write seam. In edit mode, widget-level settings changes should flow back through the dashboard shell's local config update path. In view mode, the same UI can preview changes locally, but those changes should not autosave.
- Chart selection remains local view state until the user explicitly chooses the favorite star for a chart row. That preference is stored in browser storage per dashboard/widget instance and survives reloads; it is owned by `DashboardChartWidget`, not by a route.
- Keep the settings UI inside the shared chart widget and shared chart primitives. Do not recreate chart-settings popovers in route files or page components.
- Rich time-series charts may expose manual `y` and `y2` ranges broadly, but `x` range controls are only valid when the chart owns its own non-dashboard domain.
- When a chart follows the shared dashboard timeframe, the page shell remains the source of truth for the X domain. Do not expose per-widget time-range overrides that conflict with `DashboardPageShell`.

Shared bar-chart visual rules live in `packages/ui/src/charts/ChartProvider.tsx` as `CHART_BAR_STYLE`. Use the filled mark treatment for ordinary quantitative bars and preserve renderer-specific semantics for stacked, histogram, efficiency, and segmented pill views. Interactive bars must provide date/category and value details on hover; stacked views additionally require a legend and a full-bar hit target.

#### Mobile chart viewer

- `DashboardChartWidget` owns the mobile-only expand trigger and the portal-based fullscreen viewer for catalog-rendered dashboard charts. The viewer can switch only among that widget's configured `chartIds`; selection and exploration remain local view state and must not mutate the dashboard or URL.
- `DashboardChartRenderer` accepts `presentation="embedded" | "mobile-viewer"`. It keeps data ownership unchanged while opting rich time/numeric charts into touch exploration. Browser fullscreen and orientation APIs are progressive enhancements; the fixed-viewport viewer and rotate prompt remain the reliable fallback.
- `RichTimeSeriesChart` owns pinch zoom, horizontal pan, double-tap/reset, and data-domain clamping for the mobile-viewer presentation. Categorical renderers stay readable and tappable rather than inventing a continuous zoom model.

### 6. Hooks and Data Layer

`packages/hooks` owns dashboard-facing data access and lightweight normalization. `DashboardRenderer` owns the dashboard-wide coordination layer: it derives a sorted, deduplicated requirement manifest from visible widgets and supplies the result through `DashboardDataProvider`.

Use hooks for:

- endpoint access
- response normalization
- cache keys
- page-level aggregate fetches that several widgets share
- the typed `POST /v1/metrics/batch` request used by metric chips

Widgets read provider data through selector adapters so a status update only re-renders chips that select the changed field. Outside a dashboard provider, adapters retain their direct-hook fallback for detail pages and integrations. Live status remains memory-only and fast-refreshing; bounded historical metric summaries may use the normal persisted cache while refreshing.

The batch API combines dashboard-chip values with the complete retained series
needed by visible sparklines. Dashboard requests use `density: "full"`, which
returns raw trip/telemetry/session points without an automatic point cap; the
legacy `compact` mode remains available to external callers that explicitly
need a bounded response. Maps, tables, trip geometry, and trip-detail
synchronized samples stay on their specialized endpoints. Chart widgets mount
exactly one query source: the active picker selection. Offscreen charts, maps,
and tables mount through an intersection boundary with a small preload margin,
preserving their existing loading shapes and interaction contracts once visible.

### High-density data rules

Pages that render many trips or long telemetry histories must keep the browser work bounded:

- Fetch one page-level aggregate for a map or coordinated detail view instead of one request per route or metric.
- Persist compact route previews with the trip record; generate a preview from linked telemetry only when a legacy row is missing one.
- Return complete retained dashboard history through typed chart/batch contracts; do not replace points with range-dependent averages or a display cap. Keep raw compatibility endpoints for integrations, but do not compose their untyped records in the page.
- Dashboard line and area views may apply a user-selected display-only time filter (`Raw` through `7 days`). The filter preserves each retained timestamp and changes only rendered values; it never changes API density or chart spacing. They may independently persist `Curve smoothness` as `Straight`, `Gentle` (the default), or `Smooth`. The shared chart seam calculates PCHIP-style slopes from actual X/Y deltas, uses monotonic weighted harmonic means within rising or falling runs, and flattens reversals and plateaus. Each Hermite segment becomes Bezier controls at one-third and two-thirds of that segment's X span, so handles stay ordered; Gentle is the halfway blend from straight controls and Smooth uses the full shape-preserving controls. Duplicate or invalid X intervals fall back to straight geometry. Rich chart strokes, area upper edges, and sensor sparklines use this same helper. Paths break at null samples unless a chart opts into `connectGaps`; tooltips remain anchored to the original samples. Sensor bar sprites may use the display filter as an explicit bin: non-raw windows sum source values into fixed, non-overlapping periods. Other intentional bar/category aggregations remain unchanged.
- For normalized vehicle history, prefer typed, allowlisted series with null-preserving sparse values. The Settings telemetry lanes contract may remain explicitly bucketed because it is a density inspector, not a dashboard chart.
- Use canvas-backed charts for dense series. Shared uPlot charts may use a `cursorSyncKey` so synchronized cursors stay inside the chart layer instead of re-rendering the page on every pointer movement.
- For intentionally sparse telemetry detail series, opt into `connectGaps`: line/area paths span null samples while tooltips carry the last finite reading until the next valid sample. Keep the opt-in local to views where that interpolation is semantically safe.
- When an adaptive sample count is presented as a distribution, convert it with the server-reported sample interval and label the result as approximate time rather than raw sample count.
- Mark dense query keys as non-persistent and keep a byte budget on the remaining local query cache.

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
  dashboardModel.ts           # identity, ownership, layout, and visibility helpers
  dashboardVisibility.ts      # typed conditions, runtime resolution, compatibility migration
  DashboardRenderer.tsx       # mode orchestration between view and edit grids
  DashboardGrid.tsx           # view-mode CSS grid
  GridEditor.tsx              # edit-mode React Grid Layout canvas
  WidgetChrome.tsx            # shared widget frame and edit overlay
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
- keep widget hover/edit chrome in `WidgetChrome`
- keep layout mutation rules in `dashboardModel.ts`
- add reusable conditional states through `dashboardVisibility.ts`
- compose page extras explicitly
- reuse `packages/ui` before creating page-local visuals
- reuse `packages/hooks` before embedding fetch logic in route wrappers

### Do Not

- add `if (slug === ...)` branching inside the shared shell for page-only content
- add direct page composition logic to `DashboardRenderer`
- add dashboard- or route-specific conditional visibility branches
- duplicate edit, clone, export, import, or lock handling in a second route scaffold
- put page-specific API calls inside `packages/ui`
- use widgets as a substitute for page-level orchestration when several widgets need shared context

## Next Structural Step

The current shell is the first stabilization step. If the number of built-in dashboards keeps growing, the next evolution should be a lightweight page-definition layer so routes declare metadata instead of assembling custom wrapper logic repeatedly.
