# Chart architecture

Riviamigo charts are first-class persisted resources. A chart record owns server metadata and a versioned `ChartDefinitionV1` config. The stable `slug` is the durable identity used by dashboard favorites, widget display overrides, exports, and assignments; the database UUID is only an internal record identity.

## Ownership and resolution

- Bundled rows have `owner_id = NULL`, `is_default = true`, and a baseline revision.
- A personal row with the same slug shadows the bundled row for that user, including when the personal row is disabled or unassigned.
- Reset removes the personal same-slug row. Restore bundled updates the system row from the canonical seed.
- Standalone personal charts use their own slug and can be deleted.

The API resolves ownership before applying `is_enabled` and dashboard placement filters. This prevents a disabled personal override from leaking the system chart back into a dashboard.

Every bundled chart is assigned to the runtime `overview` placement. The persisted Overview dashboard remains slugged `dashboard`, but its managed chart host deliberately resolves assignments with `overview`. Fresh and restored Overview dashboards select `projected-range-mileage`; an account-scoped saved favorite still takes precedence. Battery, Charging, Efficiency, and Trips retain their page-specific defaults.

## Definition and safety boundary

Definitions are validated with the shared Zod schema in `packages/dashboards/src/charts/schema.ts` and mirrored Rust serde validation in `apps/api/src/services/chart_validation.rs`. V1 accepts only allowlisted source IDs, typed fields, chart marks, bounded transforms, and the safe arithmetic expression parser. SQL, JavaScript, remote URLs, executable renderer imports, arbitrary CSS, and HTML are rejected.

The canonical bundled inventory is `packages/dashboards/src/charts/defaults/defaults.json` and the TypeScript authoring defaults in the same directory. Run `pnpm charts:sync-defaults` after changing the JSON seed, and `pnpm charts:sync-defaults --check` in CI. Personal rows are never rewritten by seed synchronization.

The canonical allowlisted source capability manifest is `packages/dashboards/src/charts/sources/sources.json`. The frontend registry and API `/v1/chart-sources` response consume that same manifest. The editor capability resolver expands `metrics.series` from every `/v1/metrics/catalog` item with `supports_series=true`, while preserving specialized source fields. Rust validation requires the metric parameter to name the same known series-capable metric used by the field binding.

## Runtime data flow

The chart host resolves the assigned effective catalog and mounts only the active chart. Unchanged bundled system records use the same specialized production chart renderer as fixed dashboard charts; edited system definitions, personal overrides, and custom definitions use `ChartDefinitionRenderer` so saved configuration is never hidden by a matching slug. Editor previews pass their current unsaved definition through that same definition renderer. `packages/hooks/src/chartSources.ts` executes trusted adapters through one `useQueries` call and normalizes endpoint-specific responses into `ChartDataset`. The generic renderer aligns multiple datasets by their X-domain values before mapping marks, token colors, legends, grid, tooltip, points, curve settings, empty copy, both axes, and visible axis titles to `RichTimeSeriesChart`. Specialized source calculations remain server-owned; imported definitions cannot supply executable query code.

The precedence for display behavior is transient preview state, dashboard/widget overrides keyed by stable slug, chart-definition defaults, then renderer fallbacks. Dashboard-specific settings do not mutate the chart definition.

## Extension procedure

To add a source, add its capability manifest, trusted adapter, normalized dataset fixture, and API validation coverage. To add a renderer, register an explicit `rendererId` plugin with a typed input contract and a justification for why the shared rich-series renderer cannot express the semantics. Keep manager rows free of chart-data queries and preserve mobile viewer behavior.
