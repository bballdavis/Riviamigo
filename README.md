<p align="center">
  <img src="./apps/web/public/logo_color_lighter.svg" alt="Riviamigo logo" height="72" />
  <img src="./apps/web/public/text_black.svg" alt="Riviamigo" height="72" />
</p>

<p align="center">
  <strong>Your Rivian's data companion.</strong><br />
  A private, self-hosted home for your vehicle's battery, charging, trips, and efficiency data.
</p>

Riviamigo connects to your Rivian account, keeps the telemetry on hardware you control, and turns it into a dashboard that is pleasant to check every day. There is no separate cloud service to sign up for and no subscription layer in the middle.

> **A quick security heads-up:** Riviamigo is not designed to be exposed directly to the internet. If you share an installation outside your home network, put it behind an authenticated tunnel or identity-aware reverse proxy. The [secure deployment runbook](./docs/runbooks/secure-deployment.md) has the details.

## A quick look

Light or dark, wide screen or phone — Riviamigo is designed to stay easy to read.

| Desktop — light | Desktop — dark |
| --- | --- |
| ![Riviamigo overview in light mode on desktop](./docs/assets/readme/overview-desktop-light.png) | ![Riviamigo overview in dark mode on desktop](./docs/assets/readme/overview-desktop-dark.png) |

| Mobile — light | Mobile — dark |
| --- | --- |
| <img src="./docs/assets/readme/overview-mobile-light.png" alt="Riviamigo overview in light mode on mobile" width="280" /> | <img src="./docs/assets/readme/overview-mobile-dark.png" alt="Riviamigo overview in dark mode on mobile" width="280" /> |

## What it helps with

- Keep an eye on battery state, range, charging, and vehicle health.
- Look back at trips, efficiency, and charging history without handing the data to another service.
- Shape dashboards around the things you actually care about.
- Use the same responsive app from a desktop dashboard or your phone.

## Get started locally

The easiest way to try or contribute to Riviamigo is the local development stack.

1. Install [Node.js 20+](https://nodejs.org/), [pnpm 9+](https://pnpm.io/installation), Rust stable, and Docker Desktop.
2. Clone the repo and install its dependencies:

   ```bash
   git clone https://github.com/bballdavis/Riviamigo.git
   cd Riviamigo
   pnpm install
   ```

3. Start everything:

   ```bash
   pnpm run dev:stack
   ```

4. Open [http://localhost:5173](http://localhost:5173), create your local account, and connect your Rivian when you are ready.

That command brings up the web app, API, TimescaleDB, Redis, and local object storage together. For the complete developer setup, environment details, tests, and troubleshooting commands, see [`CLAUDE.md`](./CLAUDE.md). For a production/self-hosted installation, start with the [deployment guide](./docs/wiki-drafts/11-Docker-Compose-Deployment.md).

## Where to go next

- Want to connect your vehicle? See [Rivian account setup](./docs/wiki-drafts/12-Rivian-Account-Setup.md).
- Setting up a server or NAS? Read the [prerequisites](./docs/wiki-drafts/03-Prerequisites.md) and [secure deployment runbook](./docs/runbooks/secure-deployment.md).
- Building on Riviamigo? The [docs hub](./docs/index.md) points to the dashboard, API, and architecture guides.
- Looking for the full contributor workflow? [`AGENTS.md`](./AGENTS.md) explains the project conventions, and [`CLAUDE.md`](./CLAUDE.md) is the practical command reference.

## A small note about Rivian access

Riviamigo uses the same unofficial Rivian API flow used by the mobile app. You do not need a Rivian developer account or API key, but Rivian can change that API without notice. Keep an eye on the project issues if a Rivian app update affects connectivity.
