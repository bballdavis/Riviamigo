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

| Item | Guidance |
|---|---|
| Name | Riviamigo |
| Tagline | *Your Rivian, deeply understood.* |
| Personality | Precise, premium, technical |
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
- Theme selection is a shared shell interaction, not a route-local toggle. Support `light`, `dark`, and `system`, and make the chooser responsive so desktop can anchor to the trigger while mobile renders a viewport-aware sheet or modal that fits on screen.

## Shared Component Patterns

### Cards

- Standard cards use the existing surface, border, and radius system.
- Prominent cards should still look like part of Riviamigo, not a special-case microsite.

### Empty, loading, and error states

- Use `<EmptyState>` and `<Skeleton>` from shared primitives when they fit.
- Error states should use the established inline treatment rather than plain text.
- Loading and empty states must match the surrounding page tone and spacing.

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
