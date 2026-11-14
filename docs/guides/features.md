---
title: Features
description: Review the dashboards, vehicles, telemetry, and workflows Riviamigo currently supports.
slug: /overview/features/
---

# Features

Riviamigo is a private dashboard for the Rivian data you already have access to. It focuses on making that data useful on your own hardware.

- **Overview:** current battery, range, lock state, tire pressure, cabin and vehicle information, plus configurable charts. The overview's location map shows the current gear and speed along its bottom edge while driving, and "Parked" otherwise.
- **Battery and health:** battery history, state of charge, charging limits, and available health signals.
- **Charging:** charging sessions and energy history.
- **Trips and efficiency:** trip history, route context where available, mileage, efficiency trends, signed net power (direct when available or averaged from SoC updates), and route-aware estimated exterior temperature with explicit provenance.
- **Ownership** (preview, off until you turn it on in **Settings > Ownership**): what the vehicle has cost since purchase, on a month-by-month timeline, next to what other vehicles would have cost over the same miles.
- **External connections:** installation-wide remote, self-hosted, or disabled policies for weather, geocoding, basemaps, fuel prices, vehicle lookup, and other optional providers.
- **Dashboards:** compose saved views from the available widgets.
- **Accounts:** the first account owns the instance; owners can create activation links for other people they choose to invite. Each invitation can allow password sign-in, SSO, or both, according to the site's available methods. During invitation, an owner can assign any number of vehicles, including none; the invited account receives viewer access for every selected vehicle after activation.
- **Demo vehicles:** administrators can create an R1T, R1S, or R2 with a realistic rolling 14-day history, including sparse telemetry, trips and maps, stored weather, charging sessions and a DC curve, software and battery history, health signals, and phantom-drain periods. No Rivian credentials or optional provider calls are required. Existing R2S demo records are renamed to R2 in place during migration, preserving their history and memberships.

The exact information Rivian exposes can change, and a sleeping vehicle may not update immediately. Riviamigo presents what it receives rather than inventing missing values.

## Saving settings

Changes in **Settings** are held until you save them. As soon as you change something, a bar appears at the bottom of the page with **Save** and **Discard**; **Save** stores every change on the page at once, and **Discard** puts everything back. On a computer, Ctrl+S (Cmd+S on a Mac) also saves. If you switch to another Settings section, another vehicle, or another page with changes still unsaved, Riviamigo asks whether to save or discard them first. Theme and map style changes preview immediately and return to your saved choice if you discard them. Actions such as creating an API key, deleting a place, running a backup, or testing a connection still happen as soon as you press them.

## Ownership costs

**Ownership** starts every vehicle at its purchase price and adds costs as they land. Every Ownership setting lives in **Settings > Ownership**, which the settings button on the page opens. It is split into sections: **Purchase and value** (purchase price and date, odometer at purchase, resale value), **Running costs** (insurance and other monthly costs, tire set cost, a flat gas price), **Projection** (how many years the Project view covers), and **Maintenance schedules**. Changes are held until you press **Save** in the bar at the bottom of the page, which saves every section together; **Discard** puts them back. Resale value, monthly insurance, tire cost, and a flat gas price are optional and replace the built-in estimates when set. **Projection** sets how many years the **Project** view covers from the purchase date (5 when left blank, up to 20). A resale value is taken as what the vehicle is worth today, and later years depreciate from it. Home and DC fast charging are costed separately: each uses what your own priced sessions of that kind cost, so a session without a price is charged at your home rate or your fast-charging rate rather than one blended average. A vehicle manager can edit these values; other members can view the page and try comparisons without saving them.

- **Your vehicle** takes its total miles from the odometer: today's reading minus the reading at purchase (zero unless you enter one). A month whose drives carry odometer readings takes its miles from them; the rest of the total is spread over the months that fall short of your average. Charging costs what your recorded sessions cost: home sessions are priced by the electricity plan on your home place (set it in **Settings > Places**) and fast sessions by what the network billed. A session without a price, such as an older one Rivian reported without a location, uses your average for its kind. Only months before your first recorded session, and months after today in the **Projected** view, are priced by the mile, from the months the odometer covers in full. Months after today follow the pace of your last year of odometer readings once they span three months, and your average since purchase until then; the **Odometer** tile shows the current reading, or in the **Project** view where that pace takes it. If your charging before tracking began covers far fewer miles than the odometer moved, the page suggests the odometer reading at purchase that would explain it. Without a purchase date the ledger starts at the first recorded drive or charge and counts recorded drives only. Months before tracking began and months after today are shaded as **Estimated** or **Projected**.
- **Compared vehicles** are driven the same miles in the same months. Gas and hybrid vehicles pay that month's U.S. average pump price; electric vehicles pay what your charging cost per kWh that month, home and fast together, so they share your charging habits; projected months use the rate from the months the odometer covers in full. An electric vehicle's rated consumption is also adjusted for how you drive: the energy your Rivian has taken from the wall per mile over the months the odometer covers in full is compared with its own EPA rating, and the other vehicle's rating is raised or lowered by the same share (never below 80% or above 150% of its rating, and only once 500 miles of charging are recorded).
- **One-time costs** come from each vehicle's maintenance schedule and appear as steps in the line when an item falls due. Each item (an oil change, a filter, brake fluid, spark plugs, brake pads, a set of tires) is due at its mileage interval or its time interval since it was last done, whichever comes first.

### Maintenance schedules

**Settings > Ownership** starts with **Show Ownership**, which hides or shows the Ownership page for your own account. Ownership is in preview, so it is off until you turn it on; turning it off again keeps your saved prices and schedules. Below it, the maintenance schedules list the schedule behind every vehicle on the Ownership page: your Rivian, each built-in comparison vehicle, and any vehicle you added. The built-in schedules follow each manufacturer's published intervals where one exists, such as Rivian's 9,000-mile tire rotation and three-year brake fluid, Toyota's 10,000-mile or 12-month oil service, or BMW's spark plugs every sixth oil service. Brake pads and tires, which have no fixed interval, use typical service life for that kind of vehicle; electric vehicles regenerate most of their braking, so their pads last far longer. Tire life follows what owners report for the vehicle (a Tesla Model Y set lasts about 18,000 miles), and every set is also replaced after six years however few miles it has covered. Costs are typical U.S. dealer or independent-shop prices.

Each item shows how often it falls due at your own monthly mileage, what that costs a year, and how many times it has fallen due so far with when it is next due. The **To Date** view counts only items that have already fallen due, so at low mileage a change to a long interval shows up in **Project** first. Change any interval or price, add or remove items, or reset a vehicle to its built-in schedule. Schedule edits are saved per vehicle with the rest of the page's changes, and the tire set cost under **Running costs** sets the tire price on your own vehicle's built-in schedule.
- **To date** runs from the purchase date to today. **Projected** runs to the end of the projected ownership period. Both open with the month readout on today; drag the slider or tap the chart to inspect another month, and **Back to today** returns to it.

Eight reference vehicles are built in: Kia EV9, Tesla Model Y, Chevrolet Tahoe, BMW X7, Porsche Cayenne, Range Rover, Toyota Camry Hybrid, and Toyota Prius. Their prices, fuel economy, depreciation, and maintenance figures are typical U.S. estimates, not quotes. **Add a vehicle** searches fueleconomy.gov by year, make, and model for fuel economy, or accepts figures entered by hand; you supply the price. Amounts are in U.S. dollars and distances in miles.

Fuel prices and vehicle search are optional [external connections](../guides/external-connections.md). With **Fuel prices** disabled, months already stored keep their price and the rest use your flat gas price. With **Vehicle lookup** disabled, vehicles can still be added by hand.

## Maintenance jobs

**Settings > Jobs** shows the background work Riviamigo does on its own and the repairs you can run without a terminal. Each job shows its status, when it last ran, and what that run did.

### Site-wide jobs

Site-wide jobs cover every vehicle, so only admins see this section.

**Automatic** jobs run on their own schedule:

- **Location and weather catch-up** runs every 6 hours, and once when Riviamigo starts. It fills in missing coordinates, saved places, and street addresses for trips and charging sessions, up to 100 addresses per pass, then queues a weather lookup for every trip without an outside temperature, including trips whose earlier lookup failed. **Run now** starts a pass straight away; a scheduled pass is skipped while yours is still going. Addresses and weather are looked up only when those services are turned on in **Settings > External Connections**.
- **Weather lookups** works through the queued weather lookups one at a time and retries failed ones. Its row shows how many are waiting and how many finished in the last day. It shows **Paused** when the weather service is turned off or has reached its daily limit.
- **Scheduled backups** shows the backup schedule and how the latest scheduled backup went. Change the schedule, back up now, or restore in **Settings > Backups**.
- **Security log cleanup** runs daily and removes security log events older than a year.

**Manual** jobs are repairs to run after an update that changes how something is calculated:

- **Recalculate charging costs** prices every vehicle's charging sessions again with their current cost profiles, charging-network settings, and any corrections you made. Costs are normally worked out once, when a session ends or when you edit a cost profile; run this after an update that changes how costs are calculated, so older sessions pick up the fix.
- **Recalculate trip energy** works out every trip's energy use and efficiency again from its starting and ending battery levels, the same way new trips are calculated.

### Vehicle jobs

Pick a vehicle from the list to see its jobs. Only the vehicle's owner or manager can start one; other members can see them.

- **Charging history backfill** downloads the vehicle's full charging history from Rivian and merges it with the sessions Riviamigo recorded.
- **Recover missed charging sessions** adds sessions that the vehicle's charging telemetry shows but Riviamigo never recorded, and closes a session left open when Riviamigo restarted during a charge. It only adds sessions where nothing is recorded and only fills in values an open session is missing: it never changes, merges, or removes a recorded session or your corrections. Charges that ended in the last two hours are left for the normal charging tracker.

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
