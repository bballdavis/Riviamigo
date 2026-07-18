<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/logo-lockup-dark.png" />
    <img src="./docs/assets/readme/logo-lockup-light.png" alt="Riviamigo" width="340" />
  </picture>
</p>

<p align="center">
  <strong>Your Rivian's data companion.</strong><br />
  A private, self-hosted home for your vehicle's battery, charging, trips, and efficiency data.
</p>

I built Riviamigo because I've loved running a self-hosted analytics/data retention like Teslamate for my Tesla for years now, and I wanted somethign similar for Rivian (with maybe a bit more directness than the grafana piece of Teslamate). It connects to your Rivian account, collects the telemetry available to you, and turns it into dashboards that are useful at a glance and still detailed when you want to dig deeper.

Riviamigo runs on hardware you control. There is no Riviamigo-hosted account, subscription, or product analytics service in the middle. Your vehicle history lives in your own database, your backups go where you choose, and you decide who can access the installation.

With all that said, but shoutout to the guys over at Teslamate, I definitely used some of those dashboards as inspiration.  Also, the [Unofficial Rivian API](https://rivian-api.kaedenb.org/) folks and the [HASS Rivian Integration](https://github.com/bretterer/home-assistant-rivian) team for the hard work they've done poking around the Rivian ws graph.

## What Riviamigo does

- **Vehicle overview:** See battery state, estimated range, charging status, lock state, tire pressure, cabin details, vehicle details, and other current information in one place.
- **Battery and health:** Follow state of charge, range, charging limits, battery history, phantom drain, and the health signals Rivian makes available.
- **Charging:** Review charging sessions, energy use, charging curves, connection status, and charging history.
- **Trips and efficiency:** Browse trip history, route context, mileage, driving efficiency, and longer-term trends.
- **Historical telemetry:** Keep the data your vehicle reports so you can look back at more than its current state.
- **Custom dashboards:** Use the built-in dashboards as they are, edit the installation-wide defaults, or make personal copies with the widgets and charts you care about.
- **Multiple vehicles:** Connect and switch between more than one vehicle in the same installation.
- **Sharing:** Invite other people to the installation and give them access only to the vehicles they should see. Vehicle access can be managed with owner, manager, and viewer roles.
- **Desktop and mobile:** Use the same responsive interface from a desktop, tablet, or phone, with light and dark themes.
- **Optional connections:** Choose whether to use remote, self-hosted, or disabled providers for weather, maps, and geocoding.
- **Demo vehicles:** Create an R1T, R1S, or R2S with realistic sample history so you can explore the app without connecting a Rivian account.

The exact data available depends on what Rivian reports, and that can change over time. A sleeping vehicle may also take a while to update. Riviamigo shows the information it receives instead of filling gaps with made-up values.

## A quick look

These are live, redacted views of Riviamigo at desktop and mobile sizes.

### Desktop

**Overview**

| Light | Dark |
| --- | --- |
| ![Riviamigo overview in light mode on desktop](./docs/assets/readme/overview-desktop-light.png) | ![Riviamigo overview in dark mode on desktop](./docs/assets/readme/overview-desktop-dark.png) |

**Charging**

| Light | Dark |
| --- | --- |
| ![Riviamigo charging dashboard in light mode on desktop](./docs/assets/readme/charging-desktop-light.png) | ![Riviamigo charging dashboard in dark mode on desktop](./docs/assets/readme/charging-desktop-dark.png) |

### Mobile

| Overview, light | Overview, dark | Charging, light | Charging, dark |
| --- | --- | --- | --- |
| <img src="./docs/assets/readme/overview-mobile-light.png" alt="Riviamigo overview in light mode on mobile" width="180" /> | <img src="./docs/assets/readme/overview-mobile-dark.png" alt="Riviamigo overview in dark mode on mobile" width="180" /> | <img src="./docs/assets/readme/charging-mobile-light.png" alt="Riviamigo charging dashboard in light mode on mobile" width="180" /> | <img src="./docs/assets/readme/charging-mobile-dark.png" alt="Riviamigo charging dashboard in dark mode on mobile" width="180" /> |

## Quick install

Riviamigo runs as a Docker Compose stack. You will need Git, Docker Engine with Docker Compose v2, a trusted host with persistent storage, and a safe way to reach the app.

> **Keep it private:** Riviamigo is meant to run on a trusted home network. The standard stack publishes port 8080, so protect it with a host firewall and an authenticated HTTPS tunnel or identity-aware reverse proxy before allowing remote access. Read the [secure remote access guide](https://riviamigo.com/docs/operations/secure-remote-access/) before making the app available outside your local network.

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/bballdavis/Riviamigo.git
   cd Riviamigo
   ```

2. Create your `.env` file, then replace every placeholder using the [configuration guide](https://riviamigo.com/docs/getting-started/configuration/). Do not commit this file.

   ```bash
   cp compose/.env.example .env
   ```

3. Start the published stack:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

4. Protect port 8080 with an authenticated HTTPS gateway and host firewall, open that address, create the first owner account, and connect your Rivian.

That is the short version. The [Getting Started path](https://riviamigo.com/docs/getting-started/) walks through installation and verification, while [Operations](https://riviamigo.com/docs/operations/) covers updates, logs, security, backups, and recovery.

## Documentation

The [Riviamigo documentation site](https://riviamigo.com/) publishes the complete canonical `docs/` tree through six functional sections: Overview, Getting Started, User Guide, Operations, Development, and Reference.

- [Getting Started](https://riviamigo.com/docs/getting-started/): install, verify, secure, and protect Riviamigo.
- [Prerequisites](https://riviamigo.com/docs/getting-started/prerequisites/): check the host, Docker, storage, browser, and network requirements.
- [Deployment and updates](https://riviamigo.com/docs/operations/deployment-and-updates/): configure gateways, update the stack, inspect logs, and recover an installation.
- [Configuration](https://riviamigo.com/docs/getting-started/configuration/): prepare production environment variables and secrets.
- [Rivian account setup](https://riviamigo.com/docs/getting-started/rivian-account/): connect an account and work through Rivian MFA or login repair.
- [Backup and restore](https://riviamigo.com/docs/operations/backup-and-restore/): create, download, verify, and restore complete recovery packages.
- [Development](https://riviamigo.com/docs/development/): review architecture, implementation references, runbooks, and governance.

For the complete architecture, API, security, dashboard authoring, maintenance, and contributor material, use the [Development documentation](https://riviamigo.com/docs/development/).

## Privacy

Riviamigo does not include product analytics, tracking pixels, or metrics sent to a Riviamigo-operated service. Your dashboard data stays in the database and backups you operate. It does make the external requests needed to talk to Rivian, and some optional map, weather, geocoding, or backup features may contact their respective providers. Read the [privacy details](./docs/privacy.md) before choosing where and how to host it.

## AI, review, and releases

I use AI coding tools as assistants, not as owners of a release. I review and test AI-assisted changes before release, and the project's CI includes dependency and secret checks, plus security auditing with `cargo audit`, `pnpm audit`, Gitleaks, Semgrep, and Trivy. CI is useful evidence, but it is not a substitute for human review. See the [contributor guide](./docs/contributing.md) and [security audit](./docs/security-audit.md) for the full process.

## License

Riviamigo is licensed under [GPL-3.0-only](./LICENSE). You can use, modify, and share it, and distributed derivative work must remain open source under the same license. See the [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) for the plain-language details.

## Developing Riviamigo

If you want to contribute or run the developer stack, [`CLAUDE.md`](./CLAUDE.md) is the concise developer setup and command guide. The [repository docs hub](./docs/index.md) routes you to the architecture, dashboard, API, security, and contributor references.
