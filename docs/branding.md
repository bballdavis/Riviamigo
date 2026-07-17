# Riviamigo Brand And Visual System

## Audience

Frontend contributors and reviewers making shared UI decisions.

## Source Of Truth

This document is the canonical visual system reference for Riviamigo. Update it when reusable patterns, tokens, icon usage, spacing, page composition, or copy conventions change.

## Adjacent Docs

- [`./index.md`](./index.md)
- [`./frontend/dashboard-architecture.md`](./frontend/dashboard-architecture.md)
- [`./contributing.md`](./contributing.md)

## Identity

| Item        | Guidance                                        |
| ----------- | ----------------------------------------------- |
| Name        | Riviamigo                                       |
| Tagline     | _Your Rivian, deeply understood._               |
| Personality | Precise, premium, technical                     |
| Visual mood | More instrument cluster than generic SaaS admin |

## Tokens

Token values live in `packages/ui/src/tokens/globals.css`.

Rules:

- Use semantic tokens only.
- Do not add raw hex, named colors, `rgb()`, or arbitrary Tailwind palette colors.
- If a needed color does not exist, add a token first and then use it semantically.

## Typography

- Display and headings: Space Grotesk
- Body and UI copy: Inter
- Monospace: JetBrains Mono

Common usage:

- Page title: `text-2xl font-bold font-display`
- Section title: `text-base font-semibold`
- Card label: `text-[11px] font-semibold uppercase tracking-widest text-fg-tertiary`
- Body: `text-sm`
- Meta or hint: `text-xs text-fg-tertiary`

## Core Layout Rules

- Preserve shared shell behavior through `PageLayout`, `AppLayout`, and dashboard shell seams.
- Prefer existing primitives and shared dashboard widgets over route-local card systems.
- Keep route files thin; visual composition belongs in components and shared seams, not branching routes.
- Use consistent card radius, padding, and surface hierarchy across pages.

## Icon And Control Rules

- Preserve icon family consistency inside a page and within shared admin/dashboard surfaces.
- Use the full battery glyph for the shared Battery main-navigation destination; reserve level-specific battery glyphs for live status indicators.
- Prefer icon-plus-label patterns already established by shared primitives instead of inventing one-off controls.
- Keep control order stable when editing existing flows unless the redesign intentionally updates the documented pattern.
- Text inputs and textareas use the active theme surface for normal, focused, selected, and browser-autofilled values. The caret and selection use the accent token; browser-default autofill colors are not part of the product palette.
- Dashboard toolbar controls use the elevated surface consistently across vehicle selection, efficiency toggles, and date-range triggers.
- Dashboard management rows use matching secondary icon-plus-label buttons for Open, Edit, and Export. Action groups wrap on small screens without shrinking below touch-safe targets; destructive Reset, Delete, and Restore actions remain visually distinct.
- User-facing choice menus use the shared `SelectPicker` surface with a checkmarked selected state, keyboard navigation, and in-app dismissal; native browser select menus are not part of the product UI.
- Dashboard edit mode uses compact icon controls directly on each widget. Keep edit and move controls visibly present with subdued default contrast, strengthen them on hover/focus/selection, and never make pointer hover the only way to discover or activate them.
- Resizable dashboard widgets use a persistent subtle corner handle in edit mode. Fixed-size widgets use a lock indicator and must not expose a resize hit target.
- Theme selection is a shared shell interaction, not a route-local toggle. Support `light`, `dark`, and `system`, and make the chooser responsive so desktop can anchor to the trigger while mobile renders a viewport-aware sheet or modal that fits on screen.

## Responsive Control Surfaces

- Shared control surfaces must be mobile-friendly by default. Validate the real interaction at small-screen breakpoints in the same change.
- On desktop, compact settings surfaces should anchor to their trigger instead of covering unrelated content.
- On mobile, the same shared surface should fall back to a bottom sheet or modal with safe-area padding, clear dismissal, and stacked full-width controls.
- Chart settings use one centered, viewport-bounded modal on desktop and mobile. Keep its sections scrollable inside the dialog, keep the header visible, and lay paired numeric range fields out as two distinct columns. Entering Manual range mode seeds empty fields from the chart's currently rendered axis range.
- Mobile primary navigation is a full-screen sheet, not a scaled-down desktop rail. Keep destination navigation at the top and vehicle/account utilities at the bottom; use an explicit close control, preserve focus on dismissal, and provide at least 44px touch targets (56px for primary destinations).
- In the collapsed desktop sidebar, center the vehicle connection indicator when no live battery indicator is available; use the two-column status layout only when both indicators are present.
- The dashboard editor follows this rule as a bounded bottom panel on mobile and must reserve enough document space to keep widget controls scrollable above it.
- Conditional dashboard previews use a compact labeled segmented control in the shared editor drawer. The selected state uses the existing accent treatment, while both choices remain readable and touch-safe on mobile.
- Compact controls still need touch-safe hit targets, readable labels, and enough spacing for numeric inputs, segmented toggles, and sliders.
- Reusable settings panels should stay within shared seams such as `packages/ui`, dashboard widgets, or shared shell controls rather than route-local popovers.

## Shared Component Patterns

### Cards

- Standard cards use the existing surface, border, and radius system.
- Prominent cards should still look like part of Riviamigo, not a special-case microsite.
- Compact card badges should use the shared `Badge` primitive instead of ad hoc border pills.
- Only show timeframe badges when the timeframe itself adds meaning. For battery and charging summary cards, omit `Current` labels and use a small `Lifetime` badge only on lifetime-scoped history cards.
- Range-scoped sensor cards must display a server-calculated value for the selected dashboard timeframe, never the last point from their background sparkline. Use the shared tooltip trigger beside a compact domain-specific label when a derived value needs a short explanation.

### Charts

- Dashboard sensor sprites and time-series charts use the editor-selected curve color. Canvas renderers must resolve theme tokens such as `var(--rm-accent)` before drawing.
- The shared display control is **Display filter**, not geometric curve smoothing. Its time-window choices are `Raw`, `15 min`, `1 hr`, `6 hr`, `24 hr`, `3 days`, and `7 days`; sprites default to `24 hr` and dashboard charts to `15 min`. A bar sprite sums its source values into non-overlapping time bins, so activity totals remain truthful while the card is easier to read; `Raw` remains available when individual events matter.
- Eligible line and area views expose **Curve smoothness** with three independently persisted positions: `Straight`, `Gentle` (the default), and `Smooth`. This renderer-only path shaping preserves recorded timestamps, tooltip values, point counts, and null-gap behavior. `Straight` draws hard point-to-point corners. `Gentle` blends halfway from those straight controls toward the shape-preserving curve. `Smooth` uses the full irregular-time-aware curve for the strongest rounded, hilly appearance. Both curved positions keep Bezier handles inside each timestamp segment and cannot rise above or fall below its adjacent recorded values. Bars, scatter, stepped charts, non-smoothable supporting series, and categories bypass smoothing; surfaces without chart settings do not expose the control.
- Ordinary quantitative bars use the shared filled-bar treatment from `CHART_BAR_STYLE`: semantic chart colors, quiet gridlines, consistent width/opacity, and rounded tops where the renderer supports them. Outline-only bars are not the default dashboard treatment.
- Every interactive bar chart must expose the date/category and formatted metric value on hover. Stacked bars must also provide a legend and keep hover/click hit-testing on the full bar rather than individual visual segments.
- Keep chart geometry semantically appropriate: daily totals may use one filled series, while daily charge-session composition remains a stacked AC/DC/Unknown view.
- Charging-curve analysis uses dense power-colored evidence points, fading from accent orange at lower power to green at higher power. Its single compact comparison button overlays the chart rather than consuming chart height and cycles a smooth local-regression trend line through Observed, Best observed, and Off; the default is the representative observed regression, a best-observed mode must name its upper-quartile method, and estimated history must remain visibly distinct and excluded from both summaries.
- On mobile, dashboard charts expose an on-theme expand control. The expanded viewer is an opaque, safe-area-aware fullscreen surface: its picker and close controls are anchored to opposite viewport edges so they do not consume chart height. They fade after the viewer first becomes available and return on a chart tap or Enter/Space, while the viewer uses a solid accent rotate prompt with large iconography before landscape exploration. The viewer must prevent page scroll, overscroll, and background interaction until it closes.
- Time and numeric charts support horizontal range selection, touch-first pan and pinch exploration in the viewer, and a conditional top-right icon-only reset control that returns to the full range. Categorical charts keep full category/value detail and touch-safe selection rather than simulating a meaningless zoom level.

### Vehicle artwork

- Rivian API artwork remains the primary source. Local model artwork is the final fallback for missing image metadata, protected-image fetch failures, browser image errors, and demo/test vehicles. Packaged fallbacks support R1S, R1T, and R2S; unsupported models keep the neutral vehicle icon.
- Resolve every consumer through `resolveVehicleArtwork(images, model, usage)` and render protected sources through `AuthenticatedVehicleArtwork` using its returned `fallback`. Do not hard-code route-local paths or implement a second placement picker.
- Surface priority is part of the contract: Overview uses API overhead then the model overview; Charging uses API side-charging then the model charging composition; Health uses an explicit hero or three-quarter image, plain side, front, then the model health hero; Settings uses API side, model side, then the neutral icon. Local artwork never invents open-door or charging overlays.
- Source renders under `assets/vehicles_generated` are not presentation assets. Regenerate the transparent, normalized files under `apps/web/public/vehicle-images/fallbacks` with `scripts/build_vehicle_fallback_artwork.py`.
- The semantic canvases are stable contracts: `overview` is a 640×1440 portrait overhead image rotated by the shared overview frame; `charging` is a 1200×900 charge-port-end composition with no API crop transform; `health` is a 1600×900 three-quarter hero; `vehicle-card` is a 1200×560 plain side view stored as `side.webp`.
- API and local charging artwork intentionally use different presentation rules. Put fallback-only class and style changes in `fallbackProps` instead of adding model-specific CSS guesses to route code. R1 source crops focus on the front charge port, while the R2S source crop focuses on its rear charge port.
- Keep the transparent canvas and visible bounds consistent across models. Validate changes on both light and dark surfaces and run the artwork build in check mode before review.

### Empty, loading, and error states

- Use `<EmptyState>` and `<Skeleton>` from shared primitives when they fit.
- Error states should use the established inline treatment rather than plain text.
- Loading and empty states must match the surrounding page tone and spacing.
- Shared status sensors should not drift between `Needs data`, raw `undefined`, and placeholder dashes. Use the blue `Unavailable` chip for never-seen data, and prefer last-known values plus a small `Last updated ...` line when historical data exists.

### Page composition

- Start from shared shell/layout primitives.
- Use ambient decoration sparingly and keep it `aria-hidden`.
- Accent color is for interaction, emphasis, and active state, not decorative noise.

## Copy Tone

- Precise, not marketing-heavy.
- Technical but readable.
- Prefer direct status language over celebratory or vague system messages.
- Respect user unit preferences; never hard-code imperial-only wording.

## Do And Do Not

### Do

- reuse shared primitives before building route-local UI
- update this document when a reusable visual rule changes
- check spacing, icon consistency, control ordering, and state treatments during review

### Do not

- add raw colors
- create one-off visual systems for single pages that should match the rest of the app
- treat “close enough” styling as acceptable when the app already has a documented pattern
