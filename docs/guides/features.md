---
title: Features
description: Review the dashboards, vehicles, telemetry, and workflows Riviamigo currently supports.
slug: /overview/features/
---

# Features

Riviamigo is a private dashboard for the Rivian data you already have access to. It focuses on making that data useful on your own hardware.

- **Overview:** current battery, range, lock state, tire pressure, cabin and vehicle information, plus configurable charts.
- **Battery and health:** battery history, state of charge, charging limits, and available health signals.
- **Charging:** charging sessions and energy history.
- **Trips and efficiency:** trip history, route context where available, mileage, efficiency trends, signed net power (direct when available or averaged from SoC updates), and route-aware estimated exterior temperature with explicit provenance.
- **Ownership:** what the vehicle has cost since purchase, on a month-by-month timeline, next to what other vehicles would have cost over the same miles.
- **External connections:** installation-wide remote, self-hosted, or disabled policies for weather, geocoding, basemaps, fuel prices, vehicle lookup, and other optional providers.
- **Dashboards:** compose saved views from the available widgets.
- **Accounts:** the first account owns the instance; owners can create activation links for other people they choose to invite. Each invitation can allow password sign-in, SSO, or both, according to the site's available methods. During invitation, an owner can assign any number of vehicles, including none; the invited account receives viewer access for every selected vehicle after activation.
- **Demo vehicles:** administrators can create an R1T, R1S, or R2 with a realistic rolling 14-day history, including sparse telemetry, trips and maps, stored weather, charging sessions and a DC curve, software and battery history, health signals, and phantom-drain periods. No Rivian credentials or optional provider calls are required. Existing R2S demo records are renamed to R2 in place during migration, preserving their history and memberships.

The exact information Rivian exposes can change, and a sleeping vehicle may not update immediately. Riviamigo presents what it receives rather than inventing missing values.

## Saving settings

Changes in **Settings** are held until you save them. As soon as you change something, a bar appears at the bottom of the page with **Save** and **Discard**; **Save** stores every change on the page at once, and **Discard** puts everything back. On a computer, Ctrl+S (Cmd+S on a Mac) also saves. If you switch to another Settings section, another vehicle, or another page with changes still unsaved, Riviamigo asks whether to save or discard them first. Theme and map style changes preview immediately and return to your saved choice if you discard them. Actions such as creating an API key, deleting a place, running a backup, or testing a connection still happen as soon as you press them.

## Ownership costs

**Ownership** starts every vehicle at its purchase price and adds costs as they land. Every Ownership setting lives in **Settings > Ownership**, which the settings button on the page opens. It is split into sections: **Purchase and value** (purchase price and date, resale value), **Running costs** (insurance and other monthly costs, tire set cost, a flat gas price), **Projection** (how many years the Project view covers), and **Maintenance schedules**. Changes are held until you press **Save** in the bar at the bottom of the page, which saves every section together; **Discard** puts them back. Resale value, monthly insurance, tire cost, and a flat gas price are optional and replace the built-in estimates when set. **Projection** sets how many years the **Project** view covers from the purchase date (5 when left blank, up to 20). A resale value is taken as what the vehicle is worth today, and later years depreciate from it. Home and DC fast charging are costed separately: each uses what your own priced sessions of that kind cost, so a session without a price is charged at your home rate or your fast-charging rate rather than one blended average. A vehicle manager can edit these values; other members can view the page and try comparisons without saving them.

- **Your vehicle** uses the miles and charging costs Riviamigo recorded for each month. Months between the purchase date and the first recorded drive, and months after today in the **Projected** view, use your recorded daily average and are shaded as **Estimated** or **Projected**.
- **Compared vehicles** are driven the same miles in the same months. Gas and hybrid vehicles pay that month's U.S. average pump price; electric vehicles pay your blended charging rate, the mix of home and fast charging you actually use.
- **One-time costs** come from each vehicle's maintenance schedule and appear as steps in the line when an item falls due. Each item (an oil change, a filter, brake fluid, spark plugs, brake pads, a set of tires) is due at its mileage interval or its time interval since it was last done, whichever comes first.

### Maintenance schedules

**Settings > Ownership** starts with **Show Ownership**, which hides or shows the Ownership page for your own account (it is on until you turn it off; your saved prices and schedules are kept). Below it, the maintenance schedules list the schedule behind every vehicle on the Ownership page: your Rivian, each built-in comparison vehicle, and any vehicle you added. The built-in schedules follow each manufacturer's published intervals where one exists, such as Rivian's 9,000-mile tire rotation and three-year brake fluid, Toyota's 10,000-mile or 12-month oil service, or BMW's spark plugs every sixth oil service. Brake pads and tires, which have no fixed interval, use typical service life for that kind of vehicle; electric vehicles regenerate most of their braking, so their pads last far longer. Costs are typical U.S. dealer or independent-shop prices.

Each item shows how often it falls due at your own monthly mileage, what that costs a year, and how many times it has fallen due so far with when it is next due. The **To Date** view counts only items that have already fallen due, so at low mileage a change to a long interval shows up in **Project** first. Change any interval or price, add or remove items, or reset a vehicle to its built-in schedule. Schedule edits are saved per vehicle with the rest of the page's changes, and the tire set cost under **Running costs** sets the tire price on your own vehicle's built-in schedule.
- **To date** runs from the purchase date to today. **Projected** runs to the end of the projected ownership period. Both open with the month readout on today; drag the slider or tap the chart to inspect another month, and **Back to today** returns to it.

Eight reference vehicles are built in: Kia EV9, Tesla Model Y, Chevrolet Tahoe, BMW X7, Porsche Cayenne, Range Rover, Toyota Camry Hybrid, and Toyota Prius. Their prices, fuel economy, depreciation, and maintenance figures are typical U.S. estimates, not quotes. **Add a vehicle** searches fueleconomy.gov by year, make, and model for fuel economy, or accepts figures entered by hand; you supply the price. Amounts are in U.S. dollars and distances in miles.

Fuel prices and vehicle search are optional [external connections](../guides/external-connections.md). With **Fuel prices** disabled, months already stored keep their price and the rest use your flat gas price. With **Vehicle lookup** disabled, vehicles can still be added by hand.

## Vehicle images

Settings, Overview, Charging, and Vehicle Health use artwork associated with the
specific vehicle in your Rivian account, including its paint color when Rivian
provides it. Images for another vehicle or an unassigned preorder are not used.
While artwork is loading, unavailable, or being repaired, supported models show
a packaged model-specific image. These fallback images have a fixed paint color,
so they may not match your vehicle's actual color.

Newly delivered vehicles and preorders may not have vehicle-specific artwork in
Rivian yet. In that case the vehicle keeps the packaged image, its artwork
status explains that Rivian has no artwork for it yet, and Riviamigo checks
again about every 12 hours without reporting a Rivian account error.

## Exploring demo vehicles

Open **Settings > Vehicles**, choose **Demo Vehicle**, and select a model. Creating a model that already exists returns the same vehicle without changing its name, sharing, preferences, or dashboards. Demo vehicles are marked **Demo data** and use the same dashboards as connected vehicles, but remote commands, schedules, Rivian login repair, and remote artwork repair are not simulated.

An administrator can use **Refresh Demo Data** on a demo vehicle card to replace its illustrative history with a fresh window ending at the current time. The confirmation describes what will be replaced. Refresh preserves membership, default selection, sharing, display name, user settings, and dashboard customizations. New and refreshed demos end in connected standby so the Charging page shows its connection card without simulating an active charging rate or time-to-full. Demo weather and locations are examples only and are not current-condition claims.
