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
- Prefer icon-plus-label patterns already established by shared primitives instead of inventing one-off controls.
- Keep control order stable when editing existing flows unless the redesign intentionally updates the documented pattern.
- Dashboard toolbar controls use the elevated surface consistently across vehicle selection, efficiency toggles, and date-range triggers.
- Dashboard edit mode uses compact icon controls directly on each widget. Keep edit and move controls visibly present with subdued default contrast, strengthen them on hover/focus/selection, and never make pointer hover the only way to discover or activate them.
- Resizable dashboard widgets use a persistent subtle corner handle in edit mode. Fixed-size widgets use a lock indicator and must not expose a resize hit target.
- Theme selection is a shared shell interaction, not a route-local toggle. Support `light`, `dark`, and `system`, and make the chooser responsive so desktop can anchor to the trigger while mobile renders a viewport-aware sheet or modal that fits on screen.

## Responsive Control Surfaces

- Shared control surfaces must be mobile-friendly by default. Validate the real interaction at small-screen breakpoints in the same change.
- On desktop, compact settings surfaces should anchor to their trigger instead of covering unrelated content.
- On mobile, the same shared surface should fall back to a bottom sheet or modal with safe-area padding, clear dismissal, and stacked full-width controls.
- Mobile primary navigation is a full-screen sheet, not a scaled-down desktop rail. Keep destination navigation at the top and vehicle/account utilities at the bottom; use an explicit close control, preserve focus on dismissal, and provide at least 44px touch targets (56px for primary destinations).
- The dashboard editor follows this rule as a bounded bottom panel on mobile and must reserve enough document space to keep widget controls scrollable above it.
- Compact controls still need touch-safe hit targets, readable labels, and enough spacing for numeric inputs, segmented toggles, and sliders.
- Reusable settings panels should stay within shared seams such as `packages/ui`, dashboard widgets, or shared shell controls rather than route-local popovers.

## Shared Component Patterns

### Cards

- Standard cards use the existing surface, border, and radius system.
- Prominent cards should still look like part of Riviamigo, not a special-case microsite.
- Compact card badges should use the shared `Badge` primitive instead of ad hoc border pills.
- Only show timeframe badges when the timeframe itself adds meaning. For battery and charging summary cards, omit `Current` labels and use a small `Lifetime` badge only on lifetime-scoped history cards.

### Charts

- Ordinary quantitative bars use the shared filled-bar treatment from `CHART_BAR_STYLE`: semantic chart colors, quiet gridlines, consistent width/opacity, and rounded tops where the renderer supports them. Outline-only bars are not the default dashboard treatment.
- Every interactive bar chart must expose the date/category and formatted metric value on hover. Stacked bars must also provide a legend and keep hover/click hit-testing on the full bar rather than individual visual segments.
- Keep chart geometry semantically appropriate: daily totals may use one filled series, while daily charge-session composition remains a stacked AC/DC/Unknown view.
- On mobile, dashboard charts expose an on-theme expand control. The expanded viewer is an opaque, safe-area-aware fullscreen surface: its picker and close controls are anchored to opposite viewport edges so they do not consume chart height. They fade after the viewer first becomes available and return on a chart tap or Enter/Space, while the viewer uses a solid accent rotate prompt with large iconography before landscape exploration. The viewer must prevent page scroll, overscroll, and background interaction until it closes.
- Time and numeric charts use touch-first tap, pinch, pan, and reset controls in the viewer. Categorical charts keep full category/value detail and touch-safe selection rather than simulating a meaningless zoom level.

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
