# Getting started

This is the quick, self-hosted path—not the developer environment. It uses the production Compose stack in [`compose/`](../../compose/).

## Before you start

You will need Docker Compose v2, Git, and a trusted host. Read the [prerequisites](./prerequisites.md) first, especially if the instance will be reachable away from home.

## Bring up Riviamigo

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/bballdavis/Riviamigo.git
   cd Riviamigo
   ```

2. Create a production `.env` file. Copy the example as a reference, then set the database, Redis, origin, and production key values described in [configuration](./configuration.md). Do not commit this file.

   ```bash
   cp .env.example .env
   ```

3. Start the stack:

   ```bash
   docker compose --env-file .env -f compose/docker-compose.prod.yml up -d --build
   ```

4. Put an authenticated HTTPS gateway in front of the loopback-only origin, then open that address. Your first account becomes the instance owner and can connect the first Rivian.

The production stack intentionally listens only on `127.0.0.1:8080`. That is a feature: follow [secure deployment](./secure-deployment.md) before making it available outside your local network.

## Next steps

- [Connect your Rivian account](./rivian-account.md).
- [Check logs, update, or back up the stack](./deployment.md).
- [Understand privacy and third-party requests](../privacy.md).
