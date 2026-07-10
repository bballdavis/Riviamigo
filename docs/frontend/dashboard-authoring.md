# Dashboard Authoring Guide

## Purpose

Use this guide when adding a dashboard, adding a widget, or extending dashboard editing behavior.

The main goal is to keep future work inside the shared dashboard seams instead of reintroducing route-level duplication.

## Before You Add Code

Decide which layer owns the change.

| Change                                              | Put it here                         |
| --------------------------------------------------- | ----------------------------------- |
| New route path, URL params, route-local composition | `apps/web/src/routes`               |
| Shared page scaffolding, edit flow, common actions  | `apps/web/src/components/dashboard` |
| New dashboard widget or default config              | `packages/dashboards/src`           |
| New API query hook or response normalization        | `packages/hooks/src`                |
| Reusable chart, table, badge, primitive             | `packages/ui/src`                   |

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
6. Declare editor capabilities in the widget registry entry.

A widget should usually:

- call one hook or a small related set of hooks
- map data into one visual or table
- avoid knowing about route params beyond the provided widget context

Do not use one widget to coordinate the rest of a page.

### Widget Editor Capabilities

Every widget can declare editor metadata through `WidgetDef.editor`.

Use this for:

- `category` and `description` in the editor palette.
- `fixedSize: true` for composed/custom chips whose layout should not be resized.
- `resizable: false` or `movable: false` for special-case components.
- `maxSize` when a widget can grow but has a meaningful upper bound.
- `deprecated: true` to hide a component from the palette without breaking existing saved dashboards.

Compact source-backed sensor chips should normally stay resizable. Custom visual composites such as trip stat chips or vehicle artwork should opt into fixed size when resizing would break the composition.

## Adding A Table

Prefer the shared table seam before inventing page-local table chrome.

Use the existing shared pieces in this order:

1. `packages/ui/src/tables/DataTable.tsx` for the actual table body, sorting, empty state, and optional column visibility menu.
2. `packages/ui/src/tables/TableControls.tsx` for the standard search, rows-per-page, and pagination chrome.
3. `packages/ui/src/tables/*Columns.tsx` for column definitions that keep widths compact and readable.

Table rules:

- Keep page-local wrappers `min-w-0` and avoid horizontal scrolling as the default fix.
- Use fixed or explicit widths for dense tables before adding more columns.
- Collapse related values into one cell when the table is getting too wide, like `SoC start -> end`.
- Default-hide secondary columns instead of widening the table for rarely used data.
- Use tooltip headers for domain-specific labels so the cell text can stay compact.
- If a new table is not a good fit for `DataTable` plus `TableControls`, document why in the code and reuse the nearest shared seam rather than creating a one-off chrome block.
- If a table shows inferred vehicle behavior, define the canonical metric, exclusion rules, and evidence thresholds before wiring the UI. Do not render low-confidence derived values as if they are first-class facts.
- Prefer nullable secondary metrics over forced placeholders when the underlying evidence is weak. Phantom Drain is the model here: SoC-backed drain is canonical, range loss is derived, and state-based sleep share is hidden when coverage is weak.
- When behavior is inferred from vehicle lifecycle events, keep the source-of-truth hierarchy explicit: completed trips and charge sessions are canonical facts, while state periods and raw telemetry are overlays that annotate or validate those facts. Do not let noisy state data become a first-class session builder unless the feature is explicitly about state history itself.

When adding a new table page, make the search box and pagination semantics match the existing site patterns first. Only diverge when the data shape makes the shared controls genuinely misleading.

## Sensor Chip Language

Use `componentType: "sensor"` for compact stat chips unless the card owns a genuinely custom interaction or visual. The reusable sensor chip supports:

- Metric catalog values through `metric`, `valueMode`, and optional background graphs.
- Direct page data through `dataSource`: `batteryHealth`, `chargingSummary`, or `vehicleStatus`.
- Simple math through formulas such as `([home_kwh] / [total_energy_kwh]) * 100`.
- Composite display pieces through paths, formulas, and templates such as `/[usable_new_kwh:kWh]` or `Home [home_kwh:kWh] / Away [away_kwh:kWh]`.

For `vehicleStatus` chips, the definition also owns the semantic availability behavior.

- `current` fields render the live semantic value.
- `historical` fields render the last known semantic value plus a small `Last updated ...` line.
- `never_seen` fields render the shared blue `Unavailable` chip with tooltip context when available.
- Composite status chips such as windows or tonneau should treat any current subfield as current, otherwise fall back to historical if any constituent field has been seen before.

For source-backed chips, define the canonical behavior in `packages/dashboards/src/widgets/sensor/sensorDefinitions.ts`. Keep default dashboard JSON minimal when a definition already owns the source, unit, formula, inline secondary, label suffix, icon, value color, and graph defaults. Use widget `options` only for per-instance overrides such as `chargingConnectionVisibility` or an accent border.

The editor exposes the same language under the sensor settings:

- `Data source` chooses the backing object or metric catalog.
- `Value path`, `Fallback path`, `Formula`, and `Unit` define the primary value.
- `Label suffix`, inline fields, and `Secondary line` define compact composites while preserving the existing chip layout.

Example usable-capacity definition:

```json
{
  "dataSource": "batteryHealth",
  "valuePath": "usable_now_kwh",
  "unit": "kWh",
  "inlineSecondaryTemplate": "/[usable_new_kwh:kWh]",
  "labelSuffix": "now/new",
  "valueColor": "default"
}
```

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

`DashboardPageShell` owns the page-level edit entry and the save/discard actions for grid-backed dashboards. Route wrappers may add adjacent utilities such as import, export, or duplicate, but they should not provide their own edit-mode toggle or save controls.

Dashboard configs are sanitized at the dashboard package boundary before render, import, and save. Sanitization clamps grid positions, enforces fixed-size widgets, and keeps restored/imported JSON from violating current editor capabilities.

Use the dashboard model helpers for shared editing behavior:

- `dashboardKey` scopes drafts to the active dashboard identity.
- `materializeUserDashboardDraft` saves a user-owned copy without leaking system-default metadata.
- `materializeSystemDashboardDraft` preserves system-default identity for admin/super-user edits.
- `applyWidgetLayout` is the shared layout patch path for drag and resize changes.
- `resolveDashboardViewWidgets` owns view-only visibility transforms such as plugged/unplugged charging widgets.

In edit mode, widget chrome is split by purpose:

- move and edit affordances remain visibly present on every widget, with hover, focus, drag, and selected states increasing their emphasis
- resize handles remain subtly visible only for resizable widgets and increase emphasis during interaction
- fixed-size widgets show a lock indicator instead of a resize handle while keeping their move and edit controls
- destructive removal lives in the right-side widget editor and requires confirmation

`WidgetChrome` owns the shared frame and edit overlay. Do not add per-widget or per-route hover edit buttons. `GridEditor` should only decide selection, layout, palette, and drawer state, then delegate frame rendering to `WidgetChrome`.

The editor owns the overlay's placement, stacking, and pointer behavior through its package CSS. The web app must explicitly scan `packages/dashboards/src` from its Tailwind CSS entrypoint; do not make widget editing depend only on utility discovery from a consuming route or a long-running dev-server cache.

The editor drawer is a full-height right panel on desktop. At mobile breakpoints it becomes a bounded bottom panel and reserves matching page space so the grid remains scrollable and widget controls cannot be covered by the editor surface.

Dashboard layout persistence remains explicit-save:

- Dragging, resizing, adding, deleting, and configuring widgets update the shell's local draft.
- Save writes the whole sanitized dashboard config through the dashboard mutation hooks.
- Cancel discards the local draft and returns to the last saved config.
- Successful mutations update the dashboard list and by-slug caches immediately, then invalidate for server truth.
- Failed saves keep edit mode open and surface an in-page error so the user's draft is not lost.

Use Settings > Dashboards for durable dashboard management:

- open or edit dashboards
- duplicate a default into a user-owned copy
- export YAML
- reset user-owned copies
- admin/super-user lock, unlock, and restore bundled defaults

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
