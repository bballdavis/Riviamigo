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
- **External connections:** installation-wide remote, self-hosted, or disabled policies for weather, geocoding, basemaps, and other optional providers.
- **Dashboards:** compose saved views from the available widgets.
- **Accounts:** the first account owns the instance; owners can create activation links for other people they choose to invite. During invitation, an owner can optionally assign one vehicle; the invited account receives viewer access after activation.
- **Demo vehicles:** administrators can create an R1T, R1S, or R2S with a realistic rolling 14-day history, including sparse telemetry, trips and maps, stored weather, charging sessions and a DC curve, software and battery history, health signals, and phantom-drain periods. No Rivian credentials or optional provider calls are required.

The exact information Rivian exposes can change, and a sleeping vehicle may not update immediately. Riviamigo presents what it receives rather than inventing missing values.

## Exploring demo vehicles

Open **Settings > Vehicles**, choose **Demo Vehicle**, and select a model. Creating a model that already exists returns the same vehicle without changing its name, sharing, preferences, or dashboards. Demo vehicles are marked **Demo data** and use the same dashboards as connected vehicles, but remote commands, schedules, Rivian login repair, and remote artwork repair are not simulated.

An administrator can use **Refresh Demo Data** on a demo vehicle card to replace its illustrative history with a fresh window ending at the current time. The confirmation describes what will be replaced. Refresh preserves membership, default selection, sharing, display name, user settings, and dashboard customizations. New and refreshed demos end in connected standby so the Charging page shows its connection card without simulating an active charging rate or time-to-full. Demo weather and locations are examples only and are not current-condition claims.
