# Riviamigo Wiki

Welcome to the Riviamigo wiki. Riviamigo is a self-hosted dashboard for Rivian EV owners — it connects to Rivian's unofficial cloud API, ingests vehicle telemetry into a local TimescaleDB instance, and displays it through a React web interface you control entirely.

All your vehicle data stays on your hardware. No third-party cloud service, no subscription required.

> **Security note:** Riviamigo is not approved for direct Internet exposure.
> Shared installations require an authenticated tunnel or identity-aware reverse
> proxy in front of the application.

---

## Navigation

### Developer / Contributor Docs (Wave 1)

| Page | Description |
|------|-------------|
| [Feature Overview](Feature-Overview) | What Riviamigo can do |
| [Quick Start](Quick-Start) | Get running in under 5 minutes |
| [Prerequisites](Prerequisites) | Hardware and software requirements |
| [Architecture Summary](Architecture-Summary) | System design for contributors |
| [Coding Conventions](Coding-Conventions) | Standards for frontend and backend code |
| [Development Setup](Development-Setup) | Local dev environment step-by-step |

### Self-Hoster / Operational Docs (Wave 2)

| Page | Description |
|------|-------------|
| [Environment Variables](Environment-Variables) | Complete env var reference |
| [Docker Compose Deployment](Docker-Compose-Deployment) | Production deployment guide |
| [Rivian Account Setup](Rivian-Account-Setup) | Connecting your vehicle |
| [API Keys](API-Keys) | Programmatic access and integration |
| [Grafana Integration](Grafana-Integration) | Using Riviamigo as a Grafana datasource |
| [Backup and Restore](Backup-and-Restore) | Protecting and recovering your data |
| [Secure Deployment](Secure-Deployment) | Required authenticated gateway and network boundary |

---

## Getting Help

- Open an issue on GitHub for bugs or feature requests.
- Check [Rivian Account Setup](Rivian-Account-Setup) if your vehicle is not appearing.
- Check [Environment Variables](Environment-Variables) if the API fails to start.

> **Note:** Riviamigo uses Rivian's unofficial API. If something breaks after a Rivian app update, check the GitHub issues page — the API shape can change without notice.
