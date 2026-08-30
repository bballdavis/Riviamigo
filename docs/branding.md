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
- New-password inputs keep their real requirement directly below the field. Start neutral, show unmet requirements while the user types, and use the positive status treatment only once every displayed rule is satisfied; do not make users discover password policy through a failed submission.
- Dashboard toolbar controls use the elevated surface consistently across vehicle selection, efficiency toggles, date-range triggers, and compact leading filters. Keep neighboring controls on the same 36px height, preserve a 44px minimum hit target when a control is used in a dense content panel, and place page-specific leading actions before vehicle selection.
- Compact Health telemetry uses the same card, line, icon, and efficiency-toggle language as dashboard surfaces. Group the top panel under Connectivity with separate Wi-Fi signal, throughput, and Wi-Fi status metrics; use the shared Material Wi-Fi statusbar icon series, expose numeric dBm and throughput values, and let selected unit preferences control efficiency and mass values.
- Dashboard management rows use matching secondary icon-plus-label buttons for Open, Edit, and Export. Action groups wrap on small screens without shrinking below touch-safe targets; destructive Reset, Delete, and Restore actions remain visually distinct.
- Long-running destructive operations use a confirmation dialog with explicit impact copy and a typed phrase, followed by one viewport-bounded progress surface. Run compatibility or safety preflight before enabling the destructive action and summarize blockers in the dialog. Report byte progress only when measurable and use named phases for server work; keep validation failures, rollback state, and recovery actions visible instead of implying false precision.
- User-facing choice menus use the shared `SelectPicker` surface with a checkmarked selected state, keyboard navigation, and in-app dismissal; native browser select menus are not part of the product UI.
- Boolean settings use the compact shared `Switch` primitive with native button keyboard behavior and `role="switch"`; do not substitute oversized route-local toggles or checkboxes.
- Chart-assignment badges use the shared tag icon and deterministic token colors. Keep the assignment editor icon-only, chip-height, and immediately adjacent to the badge group; enabled state belongs at the bottom-right of the chart card, apart from ordinary actions.
- Dashboard edit mode uses compact icon controls directly on each widget. Keep edit and move controls visibly present with subdued default contrast, strengthen them on hover/focus/selection, and never make pointer hover the only way to discover or activate them.
- Resizable dashboard widgets use a persistent subtle corner handle in edit mode. Fixed-size widgets use a lock indicator and must not expose a resize hit target.
- Theme selection is a shared shell interaction, not a route-local toggle. Support `light`, `dark`, and `system`, and make the chooser responsive so desktop can anchor to the trigger while mobile renders a viewport-aware sheet or modal that fits on screen.

## Responsive Control Surfaces

- Shared control surfaces must be mobile-friendly by default. Validate the real interaction at small-screen breakpoints in the same change.
- On desktop, compact settings surfaces should anchor to their trigger instead of covering unrelated content.
- On mobile, the same shared surface should fall back to a bottom sheet or modal with safe-area padding, clear dismissal, and stacked full-width controls.
- Chart assignment and chart confirmation dialogs are opaque portalled surfaces: constrained dialogs on desktop and full-viewport, safe-area-aware dialogs on mobile. They trap and restore focus, lock background scrolling, keep the heading/actions reachable, and scroll only the choice or content region.
- The chart editor places its wide production preview before a narrower single-column form on desktop and stacks preview before controls on mobile. Section navigation may scroll horizontally, but form content and save actions must remain viewport-reachable.
- The chart editor is curve-first. Its ordinary sections are Basics, Curves, Display, and Advanced; source bindings and raw domain fields are implementation details, not primary navigation. The editor derives a compatible shared domain from the chosen curves, keeps incompatible curves searchable with a plain explanation, and puts uncommon data controls in progressive disclosure inside the affected curve. Every curve uses the same card and offers independent mark, fill, color, axis, order, legend, removal, and data controls; changes must update the production preview immediately.
- Chart settings use one centered, viewport-bounded modal on desktop and mobile. Keep its sections scrollable inside the dialog, keep the header visible, and group display/curve controls and per-axis range controls in collapsible sections. Lay paired numeric range fields out as two distinct columns. Entering Manual range mode seeds empty fields from the chart's currently rendered axis range.
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
- Multi-day time-series axes use concise calendar-date labels with no repeated dates. Preserve exact timestamps in the hover tooltip; only intraday axes show clock times.
- Range-scoped sensor cards must display a server-calculated value for the selected dashboard timeframe, never the last point from their background sparkline. Use the shared tooltip trigger beside a compact domain-specific label when a derived value needs a short explanation.

### Charts

- Fixed and assignment-driven dashboard catalogs use one shared chart frame. Overview must retain the same picker, settings, plot spacing, mobile viewer, focus behavior, and production renderer as the same chart on Battery, Charging, Efficiency, or Trips.
- Dashboard sensor sprites and time-series charts use the editor-selected curve color. Canvas renderers must resolve theme tokens such as `var(--rm-accent)` before drawing.
- The shared display control is **Display filter**, not geometric curve smoothing. Its time-window choices are `Raw`, `15 min`, `1 hr`, `6 hr`, `24 hr`, `3 days`, and `7 days`; sprites default to `24 hr` and dashboard charts to `15 min`. Dashboard filtering and curve smoothness apply to every compatible curve in the active chart. A bar sprite sums its source values into non-overlapping time bins, so activity totals remain truthful while the card is easier to read; `Raw` remains available when individual events matter.
- Eligible line and area views expose **Curve smoothness** with three independently persisted positions: `Straight`, `Gentle` (the default), and `Smooth`. This renderer-only path shaping preserves recorded timestamps, tooltip values, point counts, and null-gap behavior. `Straight` draws hard point-to-point corners. `Gentle` blends halfway from those straight controls toward the shape-preserving curve. `Smooth` uses the full irregular-time-aware curve for the strongest rounded, hilly appearance. Both curved positions keep Bezier handles inside each timestamp segment and cannot rise above or fall below its adjacent recorded values. Bars, scatter, stepped charts, non-smoothable supporting series, and categories bypass smoothing; surfaces without chart settings do not expose the control.
- Ordinary quantitative bars use the shared filled-bar treatment from `CHART_BAR_STYLE`: semantic chart colors, quiet gridlines, consistent width/opacity, and rounded tops where the renderer supports them. Outline-only bars are not the default dashboard treatment.
- Dense categorical and daily bar charts preserve every mark and full interaction target while adaptively reducing only visible text. X-axis labels use the established chart font, retain the first and last categories when they fit, and choose the densest evenly distributed non-overlapping set with at least 12 px between labels. Bar-value labels are selected by descending value with 6 px collision padding so the most useful values remain visible. Do not aggregate, rotate, truncate, scroll, or narrow the default time range to solve label collisions. Recharts axes default to `preserveStartEnd` with a 40 px minimum tick gap; small specialized categories such as the rotated Speed Histogram may document an exception.
- Every interactive bar chart must expose the date/category and formatted metric value on hover. Stacked bars must also provide a legend and keep hover/click hit-testing on the full bar rather than individual visual segments. Daily charge-session composition clips the full stack to one rounded outer silhouette so its segments remain flush and visually consistent.
- Timeline interval bars follow the same filled-bar treatment and expose the complete bar as a 44px keyboard/touch hit target. Their horizontal position and width always use the interval's actual timestamps. Overlapping intervals are stacked into visual lanes, not summed; reserve a compact bottom band (about 30% of the plot) so interval context does not overpower a primary trend. Hover and focus show the trip route, time, duration, and distance, and Enter/Space activates the trip.
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

### Documentation site

- `apps/docs` consumes `@riviamigo/ui/tokens/globals.css` directly and maps Docusaurus/Infima variables to the shared semantic tokens. Do not create a documentation-only color palette.
- Keep Space Grotesk headings, Inter body copy, JetBrains Mono code, the orange accent, shared surfaces, borders, radii, shadows, and focus rings aligned with the application.
- Documentation must support light, dark, and system modes through the same token values used by the app. Theme-specific selectors must include Docusaurus's `data-theme` attributes.
- Section landing cards clarify audience and reading order without becoming a separate marketing system. Technical pages remain direct, readable, and content-first.
- Desktop navigation and the mobile drawer expose the same Overview, Getting Started, User Guide, Operations, Development, and Reference structure. At approximately 390px, controls remain touch-safe, search remains reachable, and content never relies on horizontal scrolling.
- Documentation search uses the app tokens for its trigger, detached text-entry field, panel, focus ring, and selected results; the search UI must not fall back to the plugin's default purple palette.
- The documentation site contains no analytics, tracking pixels, cookies, or hosted search service. Production search is generated locally with the static site.

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
## Runtime Health Indicators

Vehicle connection chrome must distinguish browser/API connectivity from the
upstream Rivian telemetry feed. A green **Online** state is valid when the local
live connection is open and the selected vehicle has no collector or
authentication failure. Missing credentials, an unhealthy collector, or a
silent WebSocket feed use the shared danger-tone **Feed unhealthy** state.
Telemetry-age warnings such as an old parked battery or range snapshot remain
informational freshness details and do not imply that the feed is disconnected.

Runtime feed failures also emit an error toast with a 15-minute per-vehicle,
per-reason cooldown. Persistent failures may remind the user after the cooldown,
but status polling and page reloads must not create toast storms. Reauthentication
messages direct the user to **Settings → Vehicles**.

Estimated Rivian credential renewal is advisory chrome, not a feed-health
failure. Within seven days of the 180-day estimate, show a warning-tone action
in the expanded, collapsed, and mobile sidebar while preserving a healthy green
**Online** state when telemetry is working. The vehicle settings card repeats
the estimated date and recommendation beside the existing login-repair action.
Copy must say **estimated**, **renewal**, or **recommended** rather than claiming
that Rivian guarantees an expiration date.
