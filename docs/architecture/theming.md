---
title: Theme architecture
description: Registry, runtime, persistence, chart colors, assets, and extension rules for Riviamigo themes.
---

# Theme architecture

Riviamigo themes are account-backed, versioned color systems. Appearance mode
(`light`, `dark`, or `system`) is independent from the selected built-in or
custom theme revision. Browser storage is never authoritative.

## Ownership and generated artifacts

`packages/themes` is the pure source of truth. It owns the semantic token
catalog, built-ins, sixteen series slots, legacy chart aliases, brand paths,
inheritance validation, stable serialization, and hashes. Its generator writes
the Rust-consumable built-in registry and a checksummed asset inventory. Use:

```bash
pnpm themes:generate
pnpm themes:check
pnpm colors:check
```

Generated output must not be edited by hand. The color guard allows raw color
values only in the registry, shared token definitions, and color conversion
implementation; production consumers use semantic names.

## Runtime

`ThemeRuntimeProvider` starts at Classic dark, then atomically applies the
authenticated account response. Its snapshot contains selected and effective
mode, theme reference, revision, CSS variables, concrete chart colors and pairs,
and brand assets. It preserves the transitional `.light`, `.dark`, and
`data-rm-palette` contracts while publishing theme ID, kind, and revision.

SVG/CSS consumers read variables directly. Canvas, uPlot, MapLibre, and other
non-CSS renderers subscribe to runtime revisions so a new custom revision redraws
even when its built-in base is unchanged. Logout or account switching restores
Classic dark until the new account response arrives.

## Persistence and compatibility

Built-in selections and custom theme ownership live in account-scoped tables.
Custom revisions are append-only; retirement rehomes active preferences to the
built-in base. Selection always pins an exact published revision. Theme resources
and V2 preferences use ETags to reject conflicting updates. Publish-and-apply and
rollback validate both resource versions in one transaction because they mutate
the theme lifecycle and the account's active selection together.

The V1 preference endpoint remains available during the compatibility window.
Its `theme_palette` is the Classic/RAD projection of the selected built-in base.
A legacy mode-only write using that same projection preserves an active custom
selection; choosing the other palette intentionally switches to that built-in.

## Custom Theme V1 boundary

A custom definition must inherit from a built-in and may override only approved
semantic color pairs, `series-01` through `series-16`, and trusted brand paint
slots. The persisted paint contract is reserved, but Theme Studio keeps it
locked until approved vector masters expose real paint slots. Unknown properties,
URLs, fonts, layout, motion, scripts, arbitrary CSS, and asset uploads are
rejected. Limits are 20 active custom themes per account, 80 characters per
name, and 64 KiB per definition.

Theme Studio saves immutable revisions and publishes or publishes-and-applies
explicitly. Draft previews are scoped by default; full-app preview is in memory
and is removed on cancel, navigation, logout, or account change.

## Charts and color authoring

Saved chart definitions remain backward-compatible: legacy token names are
permanent aliases, new categorical assignments use sixteen ordered series slots,
and custom colors persist literal light/dark values. Renderers cycle after slot
16 and add patterns so color is not the only differentiator.

The shared ColorPicker uses themed swatches first, visual OKLCH controls, linked
light/dark editing, copy actions, secondary numeric formats, explicit Apply and
Cancel, deterministic sRGB gamut mapping, keyboard radio-grid behavior, live
announcements, focus restoration, and a mobile fullscreen dialog.

## Brand assets

Every app consumer uses the registry-backed resolver or runtime snapshot. The
generated asset manifest records checksums, ownership, self-containment, and
whether a file is vector or raster-backed. RAD's original outlined masters live
in `packages/themes/src/rad-assets.mjs`; generation writes self-contained SVGs
and refreshes their checksums. The check command compares generated SVGs with
those masters as well as checking registry drift. Classic retains its original
raster-backed sources. Custom paint editing remains locked until the runtime
supports applying trusted paint slots to these assets.

The documentation site intentionally stays static Classic and does not load
account preferences.
