# Chart compatibility and testing

Chart migration is a persistence change, not a visual redesign. The bundled
charts' established rendering contract is the hard-coded renderer at revision
`dbd7ae58be996e6eb5a1b01582ab73f46fb388af`; the current persisted baseline is revision 5. The immutable
semantic oracle in `apps/web/src/test/fixtures/legacyBundledChartContracts.ts`
records the recoverable contract for all 14 active bundled slugs. It is
hand-authored and independent of `defaults.json`, the catalog, and the
renderer under test.

## Contract and runtime

The oracle covers each slug's trusted source family, specialized renderer
family, X-domain kind and field, series order/labels/marks/fill/axis/colors,
axis units and fixed/zero-inclusion rules, legend and smoothing defaults,
gap-connection behavior, and empty-state copy. A known bundled slug keeps its
specialized production renderer on Overview, Battery, Charging, Efficiency,
Trips, and the chart editor. Only assignment-filtered dropdown contents differ
between those pages. Custom slugs may use the generic definition renderer.

The contract is semantic rather than pixel-for-pixel. Deterministic browser
visual checks use fixed fixture data, locale/time zone, theme, viewport, and
disabled animation; live telemetry is suitable for smoke checks but too
volatile for a screenshot oracle. The production preview must be rendered by
`ManagedChartRuntime`, not a test-only chart mock.

## Required checks

```text
pnpm -C apps/web exec vitest run src/test/dashboardChartWidget.test.tsx src/test/chartDefinitions.test.ts
pnpm -C apps/web exec vitest run src/test/chartDefinitionRenderer.test.tsx src/test/chartEditorPage.test.tsx
pnpm build
pnpm docs:check
git diff --check
```

Tests should cover canonical definitions and routing, stale baseline repair
and idempotence, intentional edits, each page assignment path,
empty/loading/error states, partial source data, responsive rich-chart layout,
tooltip and zoom interaction, editor preview parity, save/reload parity,
reset, duplicate, and import/export round trips. Add deterministic Playwright
smoke/visual checks at desktop and narrow mobile widths for changed surfaces.

## Migration lifecycle

API startup advances only bundled system rows with a lower baseline revision.
Personal rows are not silently rewritten. The known first persisted mileage
fingerprint is repaired before dashboard or editor rendering; the repair keeps
placements and the user's primary curve color, restores the dashboard timeframe, and leaves any
other edit untouched. The editor marks that repaired draft unsaved so the user
can review and explicitly save it. The repair is idempotent.

`charge-session-curve` is retired from the bundled catalog because the DC
charging chart is its supported replacement. Existing standalone detail-page
charge-session views remain available through their detail renderer; retirement
removes only the bundled system chart and does not delete user data.

## Adding or changing a bundled chart

1. Establish the historical renderer contract and record its source revision.
2. Add or update the hand-authored oracle before changing the seed.
3. Keep routing, source capabilities, and the specialized component explicit.
4. Add fixture-backed runtime, editor preview, save/reload, empty/error, and
   responsive checks.
5. Update the canonical seed, synchronize generated API artifacts, and verify
   that the active slug inventory is intentional.
6. Update architecture and user customization docs, then run the checks above.
   A visual change requires an explicit product decision; it is not an
   incidental migration side effect.
