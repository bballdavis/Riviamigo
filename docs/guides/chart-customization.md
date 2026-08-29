# Chart customization

Open **Settings > Charts** to manage chart defaults and personal charts. The manager distinguishes app defaults, customized copies, personal charts, disabled charts, locked rows, and unassigned rows.

## Lifecycle

- Editing an app default creates a personal same-slug customization for your account.
- Reset to app default removes that personal customization and reveals the bundled chart again.
- Duplicate creates an independent personal chart with a new slug.

- App defaults and same-slug customizations always use the same established production renderer. Rich-editable charts expose the curve, axis, color, mark, fill, ordering, and display inputs their specialized renderer consumes. Fixed-geometry aggregate, charging-curve, pill-bar, phantom-drain, and tire charts expose only supported color controls; ignored visual edits are rejected instead of being silently saved.
- A disabled chart keeps its dashboard assignments. Re-enabling restores those placements and preserves the stored favorite.
- Assignments control which dashboard catalogs include an enabled chart. An enabled chart with no assignments is saved as **Unassigned**.

Bundled charts are protected by the revision-5 compatibility contract. The
Overview, Battery, Charging, Efficiency, and Trips pages share one chart host
and production renderer; assignments only control which chart names appear in
each dropdown. The editor's live preview uses that same production renderer and
runtime contract. The
legacy `Chart rate curve`/`charge-session-curve` bundled entry is retired in
favor of the DC charging chart; existing charge-session detail views are not
removed.

Use **Create chart** or **Import** for a personal chart. Imports are validated before a database row is created, and a slug conflict creates a copy instead of overwriting an app default. Export downloads a versioned `.riviamigo-chart.json` file containing the same validated database definition, and Import reads that same format. Riviamigo does not create or depend on separate per-chart definition files at runtime.

## Editor

The full-window editor is available at `/settings/charts/new` and `/settings/charts/:chartId`. Rich-editable and independent charts use the curve-first workflow: choose values, then edit each supported curve input. Fixed-geometry bundled charts keep their established curve type, ordering, axes, and display behavior and show only supported color controls. Bundled charts inherit the active dashboard timeframe, while independent charts may choose dashboard, relative, or lifetime policies. The editor derives and validates the trusted X domain; Advanced JSON cannot change a bundled renderer's required X field or save an option that component ignores. The live preview uses the unsaved draft through the same runtime adapter as a saved chart, so supported visual changes appear before saving. Saved definitions can reference only Riviamigo's allowlisted source registry. They cannot contain SQL, JavaScript, remote URLs, HTML, or executable imports.

Bundled charts always use the active dashboard date range. An independent chart may use a relative or lifetime policy, labeled by the editor and runtime so its scope is explicit. Dashboard-specific display settings continue to override visual defaults without changing the saved chart.

The manager and editor are responsive surfaces. On mobile, assignment choices open in a touch-sized selector, editor sections are single-column, and Save remains in the sticky top bar.

When an old mileage record is detected, Riviamigo repairs only the known
incomplete migration fingerprint, keeps its allowed placement/color
customizations, restores dashboard timeframe inheritance, and marks the editor draft unsaved. Review and Save persists
the repaired definition; Cancel leaves the stored record unchanged. Reset
removes a same-slug personal override and restores the bundled baseline.

For maintainers, the compatibility matrix, deterministic visual-test rules,
required commands, and add-a-chart checklist are in
[Chart compatibility testing](../frontend/chart-compatibility-testing.md).
