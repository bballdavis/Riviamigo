---
title: Install Riviamigo
description: Bring up the standard private Riviamigo Compose stack and create the first owner.
slug: /getting-started/install/
sidebar_label: Install Riviamigo
---

# Install Riviamigo

This is the quick, self-hosted path—not the developer environment. It pulls published images through the standard Compose stack in [`compose/`](../../compose/).

## Before you start

You will need Docker Compose v2, Git, and a trusted host. Read the [prerequisites](./prerequisites.md) first, especially if the instance will be reachable away from home.

## Bring up Riviamigo

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/bballdavis/Riviamigo.git
   cd Riviamigo
   ```

2. Create a `.env` file. The compact Compose template contains only the values a standard install needs; set each placeholder as described in [configuration](./configuration.md). Do not commit this file.

   ```bash
   cp compose/.env.example .env
   ```

3. Start the stack:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.yml up -d
   ```

4. Put an authenticated HTTPS gateway and host firewall rule in front of port `8080`, then open that address. Your first account becomes the instance owner and can connect the first Rivian. Use a password with at least 12 characters; the setup screen shows the live requirement as you type.

The standard stack defaults to production mode and publishes port `8080`. Follow [secure deployment](./secure-deployment.md) before making it available outside your local network.

## Copy the standard Compose file

This is the exact production Compose file from the repository, included at build time so the documentation stays synchronized with the installation source. Copy it into `compose/docker-compose.yml` if you are working from a downloaded documentation bundle, or use the linked source file directly: [`compose/docker-compose.yml`](../../compose/docker-compose.yml).

```compose-include
compose/docker-compose.yml
```

Other Compose variants are available when you need them:

- [`docker-compose.build.yml`](../../compose/docker-compose.build.yml) — build the unified production image from the local checkout.
- [`docker-compose.dev.yml`](../../compose/docker-compose.dev.yml) — start development infrastructure for `pnpm dev:stack`.

## Next steps

- [Connect your Rivian account](./rivian-account.md).
- [Check logs, update, or back up the stack](./deployment.md).
- [Understand privacy and third-party requests](../privacy.md).
