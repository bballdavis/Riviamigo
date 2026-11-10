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

## Ownership costs

**Ownership** starts every vehicle at its purchase price and adds costs as they land. Enter the purchase price and date under **Edit settings** on the page, or in the vehicle's edit area in **Settings > Vehicles**; both places edit the same values. Resale value, monthly insurance, tire cost, and a flat gas price are optional and replace the built-in estimates when set. **Projected ownership** sets how many years the **Projected** view covers from the purchase date (5 when left blank, up to 20). A resale value is taken as what the vehicle is worth today, and later years depreciate from it. Home and DC fast charging are costed separately: each uses what your own priced sessions of that kind cost, so a session without a price is charged at your home rate or your fast-charging rate rather than one blended average. A vehicle manager can edit these values; other members can view the page and try comparisons without saving them.

- **Your vehicle** uses the miles and charging costs Riviamigo recorded for each month. Months between the purchase date and the first recorded drive, and months after today in the **Projected** view, use your recorded daily average and are shaded as **Estimated** or **Projected**.
- **Compared vehicles** are driven the same miles in the same months. Gas and hybrid vehicles pay that month's U.S. average pump price; electric vehicles pay your blended charging rate, the mix of home and fast charging you actually use.
- **One-time costs** such as oil changes, brakes, tires, and annual service appear as steps in the line at the mileage or anniversary they fall due.
- **To date** runs from the purchase date to today. **Projected** runs to the end of the projected ownership period. Both open with the month readout on today; drag the slider or tap the chart to inspect another month, and **Back to today** returns to it.

Eight reference vehicles are built in: Kia EV9, Tesla Model Y, Chevrolet Tahoe, BMW X7, Porsche Cayenne, Range Rover, Toyota Camry Hybrid, and Toyota Prius. Their prices, fuel economy, depreciation, and maintenance figures are typical U.S. estimates, not quotes. **Add a vehicle** searches fueleconomy.gov by year, make, and model for fuel economy, or accepts figures entered by hand; you supply the price. Amounts are in U.S. dollars and distances in miles.

Fuel prices and vehicle search are optional [external connections](../guides/external-connections.md). With **Fuel prices** disabled, months already stored keep their price and the rest use your flat gas price. With **Vehicle lookup** disabled, vehicles can still be added by hand.

## Exploring demo vehicles

Open **Settings > Vehicles**, choose **Demo Vehicle**, and select a model. Creating a model that already exists returns the same vehicle without changing its name, sharing, preferences, or dashboards. Demo vehicles are marked **Demo data** and use the same dashboards as connected vehicles, but remote commands, schedules, Rivian login repair, and remote artwork repair are not simulated.

An administrator can use **Refresh Demo Data** on a demo vehicle card to replace its illustrative history with a fresh window ending at the current time. The confirmation describes what will be replaced. Refresh preserves membership, default selection, sharing, display name, user settings, and dashboard customizations. New and refreshed demos end in connected standby so the Charging page shows its connection card without simulating an active charging rate or time-to-full. Demo weather and locations are examples only and are not current-condition claims.
