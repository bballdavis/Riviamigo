# Quick Start

This page gets you from zero to a running Riviamigo instance as fast as possible. If you want more detail on any step, see the [full deployment guide](Docker-Compose-Deployment).

---

## Prerequisites

- Docker Engine 24 or later
- Docker Compose v2 (`docker compose` — note: no hyphen)
- A Rivian account with at least one registered vehicle

---

## Steps

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_ORG/riviamigo.git
cd riviamigo
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
# Set a strong password for the database
DATABASE_URL=postgresql://riviamigo:CHANGE_ME@timescaledb:5432/riviamigo

# Set production mode
RIVIAMIGO_ENV=production
```

Leave the JWT, age encryption key, and S3 fields blank — the API auto-generates and persists them on first boot.

> ⚠️ **Warning:** Never use the default `devpassword` from `.env.example` in production. Set a real password before starting the stack.

### 3. Start the stack

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

This starts TimescaleDB, Redis, the Rust API, and the React web frontend. The database schema is applied automatically on first boot.

### 4. Open the web UI

For production, provide `JWT_SECRET`, `JWT_PUBLIC_KEY`, and
`AGE_ENCRYPTION_KEY` through a protected deployment environment, and set
`ALLOWED_ORIGINS` to the exact public HTTPS origin. Production intentionally
does not generate these keys.

The first account is the instance owner (`super_user`); after it is created,
public registration closes and admins issue activation links for additional
users.

Navigate to `http://your-server:3000` in your browser. Create your admin account on first visit.

### 5. Add your vehicle

1. Go to **Settings → Vehicles → Add Vehicle**.
2. Enter your Rivian account email and password.
3. Riviamigo will trigger an OTP (one-time passcode) to your phone via Rivian's standard auth flow.
4. Enter the OTP in the UI.
5. Your credentials are stored age-encrypted in the database.

### 6. Wait for the first telemetry poll

After adding your vehicle, allow about 30 seconds for the first telemetry poll to complete. The dashboard will populate as data arrives. If the vehicle is asleep, the first data may take longer.

---

## What's next?

- [Prerequisites](Prerequisites) — detailed hardware and software requirements
- [Environment Variables](Environment-Variables) — full reference for all configuration options
- [Docker Compose Deployment](Docker-Compose-Deployment) — reverse proxy setup, updates, and backups
- [Rivian Account Setup](Rivian-Account-Setup) — troubleshooting vehicle connections
