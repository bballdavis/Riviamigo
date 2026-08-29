# Chart customization

Open **Settings > Charts** to manage chart defaults and personal charts. The manager distinguishes app defaults, customized copies, personal charts, disabled charts, locked rows, and unassigned rows.

## Lifecycle

- Editing an app default creates a personal same-slug customization for your account.
- Reset to app default removes that personal customization and reveals the bundled chart again.
- Duplicate creates an independent personal chart with a new slug.

Bundled chart slugs—including same-slug customizations—keep the established legacy dashboard renderer and visual language. Customization changes the chart definition, sources, or dashboard assignments; it does not switch a bundled chart to the generic definition renderer.
- A disabled chart keeps its dashboard assignments. Re-enabling restores those placements and preserves the stored favorite.
- Assignments control which dashboard catalogs include an enabled chart. An enabled chart with no assignments is saved as **Unassigned**.

Use **Create chart** or **Import** for a personal chart. Imports are validated before a row is created, and a slug conflict creates a copy instead of overwriting an app default.

## Editor

The full-window editor is available at `/settings/charts/new` and `/settings/charts/:chartId`. It provides basics, trusted data sources, fields, marks, series, axes, display settings, advanced definition validation, and a live preview. Saved definitions can reference only Riviamigo's allowlisted source registry. They cannot contain SQL, JavaScript, remote URLs, HTML, or executable imports.

Dashboard date ranges remain the default chart timeframe. A chart with a relative or lifetime policy is labeled by the editor and runtime so its scope is explicit. Dashboard-specific display settings continue to override visual defaults without changing the saved chart.

The manager and editor are responsive surfaces. On mobile, assignment choices open in a touch-sized selector, editor sections are single-column, and Save remains in the sticky top bar.
