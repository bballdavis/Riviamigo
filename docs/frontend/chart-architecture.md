# Chart architecture

Riviamigo charts are first-class persisted resources. A database chart record owns server metadata and a versioned `ChartDefinitionV1` config, and that persisted definition is the runtime source of truth. The stable `slug` is the durable identity used by dashboard favorites, widget display overrides, exports, and assignments; the database UUID is only an internal record identity. Import and export use one versioned `.riviamigo-chart.json` envelope around this same validated record shape; the file is a portability mechanism, not a second runtime definition system.

## Ownership and resolution

The visual compatibility source is the pre-migration hard-coded renderer at
full revision `dbd7ae58be996e6eb5a1b01582ab73f46fb388af`; the current persisted bundled baseline is revision 5.
Database state makes that contract editable; it does not replace the
specialized renderer or alter the canonical appearance of an unedited bundled
chart. See [Chart compatibility testing](./chart-compatibility-testing.md)
for the immutable oracle and release checks.

- Bundled rows have `owner_id = NULL`, `is_default = true`, and a baseline revision.
- After migrations, API startup advances bundled system rows with an older baseline revision in place. Their UUIDs and slugs remain stable; personal rows and account chart favorites are not part of the seed update.
- A personal row with the same slug shadows the bundled row for that user, including when the personal row is disabled or unassigned.
- Reset removes the personal same-slug row. Restore bundled updates the system row from the canonical seed.
- Standalone personal charts use their own slug and can be deleted.

The API resolves ownership before applying `is_enabled` and dashboard placement filters. This prevents a disabled personal override from leaking the system chart back into a dashboard.

Every bundled chart is assigned to one or more runtime page placements. The persisted Overview dashboard remains slugged `dashboard`, but its chart host deliberately resolves assignments with `overview`. Every page-scoped chart catalog uses this same assignment-backed path; page tags determine dropdown eligibility while the shared host, runtime, and renderer remain identical. Fresh and restored Overview dashboards select `projected-range-mileage`; an account-scoped saved favorite still takes precedence. Battery, Charging, Efficiency, and Trips retain their page-specific defaults.

The first persisted-chart baseline accidentally serialized the two mileage charts as single-curve, numeric-odometer definitions. The shared compatibility adapter recognizes the complete obsolete serialized fingerprint—not merely the slug or curve count—and restores the current bundled timestamp/dual-axis structure before either dashboard rendering or editor initialization. Placement, timeframe, and primary curve color are tolerated by fingerprint matching; repair preserves placement/color and restores the canonical dashboard timeframe so preview and dashboard cannot diverge. Any other curve, source, axis, display, or interaction edit is treated as intentional and is not rewritten. The editor marks an upgraded draft unsaved so the user must review and save before the repaired personal definition replaces its stored value.

## Definition and safety boundary

Definitions are validated with the shared Zod schema in `packages/dashboards/src/charts/schema.ts` and mirrored Rust serde validation in `apps/api/src/services/chart_validation.rs`. V1 accepts only allowlisted source IDs, typed fields, chart marks, bounded transforms, and the safe arithmetic expression parser. SQL, JavaScript, remote URLs, executable renderer imports, arbitrary CSS, and HTML are rejected.

The canonical bundled inventory is `packages/dashboards/src/charts/defaults/defaults.json`. TypeScript imports and validates that file directly; there is no parallel authoring catalog. Run `pnpm charts:sync-defaults` after changing the JSON seed, and `pnpm charts:sync-defaults --check` in CI. Personal rows are never rewritten by seed synchronization.

The canonical allowlisted source capability manifest is `packages/dashboards/src/charts/sources/sources.json`. The frontend registry and API `/v1/chart-sources` response consume that same manifest. The editor capability resolver expands `metrics.series` from every `/v1/metrics/catalog` item with `supports_series=true`, while preserving specialized source fields. Rust validation requires the metric parameter to name the same known series-capable metric used by the field binding.

## Runtime data flow

The chart host resolves every page-scoped catalog from assigned database records and passes the active record into one shared chart frame. Overview, Battery, Charging, Efficiency, and Trips therefore use the same picker, settings panel, measured plot, mobile viewer, focus restoration, favorite behavior, and renderer; only their placement-filtered dropdown contents differ. Explicit fixed catalogs remain available for non-page embedded uses. Assignment metadata such as `placements` only controls eligibility. A known bundled slug always selects its established specialized renderer, whether the record is the system baseline, a saved customization, or an unsaved editor draft. Custom slugs use the registered definition renderer.

The portable bundled-renderer manifest fixes each slug's renderer family, trusted X encoding, supported curve fields, and editing profile. Editing is declared per slug rather than inferred from the underlying chart primitive: most rich time-series slugs consume editable series/display inputs, while Charging Curve Analysis is fixed-geometry even though it uses the rich primitive internally. Fixed-geometry aggregate, pill-bar, charging-curve, phantom-drain, and tire-timeline renderers expose only curve color. All bundled charts inherit the active dashboard timeframe. Frontend and API validation reject changes to ignored curve structure, marks, axes, display, interaction, sources, timeframe, units, empty copy, renderer ID, and X encodings. This closed capability boundary prevents a valid saved definition from becoming an empty, divergent, or visually unchanged chart.

`packages/dashboards/src/charts/defaults/defaults.json` is the single serialized installation/reset baseline. The TypeScript catalog imports and validates those definitions instead of reconstructing them. Renderer routing and widget dimensions remain code metadata because they select an existing component and layout; they are not a second visual chart definition. `apps/api/charts/defaults.json` is a synchronized installation artifact generated from that baseline, while database rows are authoritative after installation.

`packages/hooks/src/chartSources.ts` executes trusted adapters through one `useQueries` call and normalizes endpoint-specific responses into `ChartDataset`. Normalization materializes the global X field plus any per-curve X fields, removes rows without a usable shared-domain value, and preserves value alignment. The capability manifest pins every bundled X kind, binding, and field before a definition reaches its specialized adapter. Rich time-series adapters map marks, fill, interpolation, concrete theme colors, legends, grid, tooltip, points, curve settings, empty copy, both axes, and visible axis titles into the established production component. Line or step plus `fill: true` maps to that component's existing area mode. Specialized aggregate source calculations and geometry remain component-owned; imported definitions cannot supply executable query code or ignored presentation settings.

The normal rich/custom editor is curve-first. It combines series-capable metric catalog entries with specialized manifest fields into one searchable curve catalog and derives the compatible X domain automatically from the selected data groups. Incompatible choices remain visible but disabled with an explanation. Rich-editable bundled slugs expose the curve fields their established renderer can consume; independent custom charts use the complete compatible catalog. Fixed-geometry bundled renderers show canonical curves read-only except for supported color. Bundled timeframe is visibly inherited from the active dashboard; relative/lifetime policies are custom-chart features. Advanced JSON is validated against the same boundary and cannot bypass it. Every unsaved draft is previewed through the same adapter and renderer path as a saved record.

The precedence for display behavior is transient preview state, dashboard/widget overrides keyed by stable slug, chart-definition defaults, then renderer fallbacks. Dashboard-specific settings do not mutate the chart definition.

## Compatibility and verification

The production renderer contract is tested against a hand-authored oracle from
`dbd7ae58be996e6eb5a1b01582ab73f46fb388af`, never against the current seed. The matrix covers all 14 active
bundled slugs, including renderer family, axes, domains, series semantics,
units, legend, smoothing, connection gaps, and empty copy. The editor preview
uses the same `ManagedChartRuntime` adapter as dashboard assignments, so a
saved record and its unsaved draft follow the same production renderer and
runtime contract for the same effective definition. Rich-editable slugs
serialize through the same rich-chart props, while fixed-geometry slugs retain
their component-owned geometry. Reset returns to the bundled seed; duplicate
creates an independent slug; import/export round-trip the validated portable
definition; save/reload preserves intentional edits. Run the commands in
[Chart compatibility testing](./chart-compatibility-testing.md) before
publishing renderer or seed changes.

## Extension procedure

To add a source, add its capability manifest, curve-catalog metadata, trusted adapter, normalized dataset fixture, and API validation coverage. To add a renderer, register an explicit `rendererId` plugin with a typed input contract and compatibility predicate, plus a justification for why the shared rich-series renderer cannot express the semantics. Keep manager rows free of chart-data queries and preserve the shared frame and mobile viewer behavior.
