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
The choice is stored in this browser for that dashboard component and returns
after a reload; it does not change other chart widgets or sync to another
browser.

## Reset, delete, and restore

The recovery action depends on who owns the row:

- **Reset to default** deletes a same-slug personal override. The system version immediately becomes active for that user again.
- **Delete** removes a standalone personal dashboard that does not override a system slug.
- **Restore bundled** is an administrator action for system defaults. It replaces that system row with the layout shipped in the installed Riviamigo version.

Resetting a personal copy does not restore or modify the system row. Restoring a bundled system dashboard does not delete personal copies. Riviamigo upgrades also leave existing system edits and personal dashboards untouched unless an administrator explicitly restores a bundled version.

## Conditional dashboard previews

Some widgets appear only in a particular vehicle state. The Charging dashboard, for example, can use different widgets and overlapping positions for **Plugged in** and **Unplugged** views. A connected vehicle in standby counts as plugged in.

When a dashboard contains conditional widgets, edit mode shows a **Preview** control in the editor drawer. Switch between Plugged in and Unplugged to arrange and review both layouts. Always-visible widgets appear in both states.

Each widget's **Visibility** setting offers:

- **Always**
- **Vehicle plugged in**
- **Vehicle unplugged**

Changing the preview does not change vehicle data and is not itself saved. Widget visibility and layout changes remain part of the normal draft and persist only after **Save**. Widgets hidden by the current preview remain in the draft, so editing one state cannot erase the other state's widgets.
