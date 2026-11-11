---
title: Dashboard customization
description: Understand system defaults, personal dashboards, editing, previews, and recovery.
slug: /using-riviamigo/dashboard-customization/
---

# Dashboard customization

Riviamigo keeps an installation-wide system version of each built-in dashboard and can also keep personal dashboards for each user. Open **Settings > Dashboards** to see which version you are managing.

## System defaults and personal copies

System defaults are shared within your Riviamigo installation. Administrators and super users can edit them, and those changes affect everyone who has not made a personal override.

Choose **Customize** on a system row to create your own copy with the same dashboard slug. That copy becomes **Active for you** and takes precedence when you open the normal dashboard route. Customizing does not change the system version or another user's view.

Settings actions target the row they appear on:

- **Open default** and **Edit default** open the exact system row, even if you have a personal copy.
- **Open** and **Edit** on a personal row open that exact copy.
- **Duplicate** creates an independent personal dashboard from an existing personal dashboard.
- **Export** downloads the selected row as YAML, including conditional visibility rules.

## Chart picker defaults

Chart widgets can be switched temporarily from their chart picker. To keep a
chart as the default for that widget, hover its row and click the favorite star.
The choice is stored in your account for that dashboard component and returns
after a reload or sign-in from another browser; it does not change other chart
widgets. The bundled Overview dashboard defaults to **Battery Capacity by
Mileage**.

## Vehicle Overview location map

The Vehicle Overview header has two icons on the right: a telemetry indicator
(hover or focus it for the last update time) and a toggle between the
**cluster** view and the **current location** map. Your choice is saved to your
account, so the overview opens on the view you used last, on any device. The
cluster view is the default until you pick the map. The map view replaces the stat rows
on the right with a map centered on the vehicle's last reported location; the
battery panel and vehicle image stay in place. The vehicle appears on the map
as a small overhead image outlined in the accent color, pointed the way its
nose faces. Rivian reports the direction of travel, so after backing into a
space Riviamigo turns that reading around to show the way the vehicle actually
faces.

The expand button in the map's top-right corner gives the map more room: the
battery panel shrinks to its charge bar, the vehicle image slides over, and the
map takes the space. Press it again, or switch back to the cluster view, to
restore the normal layout. On a phone it makes the map taller instead.

In edit mode, select the Vehicle Overview widget and open **Location map** in
the editor drawer:

- **Offer location map** turns the toggle on or off for that widget.
- **Light or dark** follows the app appearance by default, or forces a light or dark map.
- **Map type** uses the map style from **Settings > Appearance** by default, or picks a specific style for this widget.

## Reset, delete, and restore

The recovery action depends on who owns the row:

- **Reset to default** deletes a same-slug personal override. The system version immediately becomes active for that user again.
- **Delete** removes a standalone personal dashboard that does not override a system slug.
- **Restore bundled** is an administrator action for system defaults. It replaces that system row with the layout shipped in the installed Riviamigo version.

For the administrator performing the restore, the saved default for the restored
managed Overview chart is also aligned with the chart in that bundle. Other
users' chart preferences are unchanged.

Resetting a personal copy does not restore or modify the system row. Restoring a bundled system dashboard does not delete personal copies. Personal dashboards are never replaced by an upgrade: saved widgets, positions, and settings remain yours. A release may apply a narrow additive patch for a bundled widget explicitly marked as managed, preserving the existing layout while adding fixed page composition that is not editor-configurable. System edits survive ordinary restarts, but a release that intentionally ships a newer dashboard baseline updates the shared system row once; users with a same-slug personal copy continue to see their own version plus any managed composition additions.

## Conditional dashboard previews

Some widgets appear only in a particular vehicle state. The Charging dashboard, for example, can use different widgets and overlapping positions for **Plugged in** and **Unplugged** views. A connected vehicle in standby counts as plugged in.

When a dashboard contains conditional widgets, edit mode shows a **Preview** control in the editor drawer. Switch between Plugged in and Unplugged to arrange and review both layouts. Always-visible widgets appear in both states.

## Dashboard page edit button

Dashboard page edit buttons are hidden by default. Open **Settings > Dashboards** and enable **Show edit button on dashboard pages** to show the page-level shortcut across every dashboard. The preference is per signed-in user. When it is off, dashboards remain editable from Settings; only the page-level shortcuts are hidden.

Each widget's **Visibility** setting offers:

- **Always**
- **Vehicle plugged in**
- **Vehicle unplugged**

Changing the preview does not change vehicle data and is not itself saved. Widget visibility and layout changes remain part of the normal draft and persist only after **Save**. Widgets hidden by the current preview remain in the draft, so editing one state cannot erase the other state's widgets.
# Chart manager

Chart definitions now have their own lifecycle in **Settings > Charts**. See [Chart customization](./chart-customization.md) for assignments, personal overrides, import/export, and the full-window editor.
