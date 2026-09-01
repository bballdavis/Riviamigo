---
title: Appearance and custom themes
description: Choose an account theme, customize chart colors, and work safely with Theme Studio revisions.
---

# Appearance and custom themes

Open **Settings → Appearance** to change how Riviamigo looks. Your choices are
saved to your account and follow you across supported browsers and devices.

Appearance mode and theme are separate:

- **Light**, **Dark**, or **System** controls brightness. System follows the
  current device setting while keeping System saved to the account.
- **Classic**, **RAD**, or one of your private custom themes controls the color
  system, chart palette, and available brand treatment.

Riviamigo does not copy a previous browser's local theme setting into the
account. Before sign-in and after logout it uses Classic dark.

## Create a custom theme

Choose **Create custom theme**, name it, and select Classic or RAD as its base.
Theme Studio has Interface, Charts, Brand, and Review sections. Missing values
always inherit from the base, so a custom theme can stay small and focused.

Saving creates a new immutable revision. Publishing makes that revision
selectable, but does not move an account already pinned to an older revision.
Use **Publish and apply** only when you want both actions together. Riviamigo
keeps up to 20 active custom themes per account.

The ordinary preview is scoped to Theme Studio. **Preview app** temporarily
applies the draft across the app in memory and displays a persistent preview
banner. Exiting, navigating away, logging out, or switching accounts restores
the saved account theme.

Critical text/surface contrast failures must be fixed before saving or
publishing. Chart contrast and distinguishability warnings are advisory because
chart context varies, but should be reviewed in both modes.

## Choose chart colors

Chart and widget editors share the same color field. Use one of the sixteen
ordered theme-series swatches for categorical data, choose a semantic/status
color, or open **Custom color**.

The custom picker starts with themed swatches and offers visual OKLCH controls.
Light and dark values are linked by default; unlink them to tune each mode or
copy one value to the other. Hex, RGB, HSL, and OKLCH inputs are also available.
Nothing changes until **Apply** is selected. Edited values are stored as a
canonical sRGB hex pair and stay literal when the account theme changes.

When a chart contains more than sixteen series, colors cycle and supported
renderers add line patterns so color is not the only differentiator.

## Brand asset status

The current logo and wordmark sources contain raster artwork. Classic and RAD
variants are checksummed and resolved through the theme system, but are not
claimed as completed vector reconstruction. Custom brand-paint controls remain
locked until self-contained vector masters pass visual approval at all app sizes.
