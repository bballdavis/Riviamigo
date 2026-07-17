---
title: Getting Started
description: Install, verify, secure, operate, and protect a Riviamigo installation.
slug: /getting-started/
sidebar_label: Getting Started
pagination_prev: index
pagination_next: guides/prerequisites
---

# Getting Started

This path takes a new self-hoster from an empty host to a verified, private, and recoverable Riviamigo installation. Work through it in order for a first installation; return directly to individual pages for later maintenance.

## Before you begin

Plan for three phases:

1. **Prepare:** confirm the host, Docker, persistent storage, network boundary, and required secrets.
2. **Install:** configure the Compose environment, start the stack, create the first owner, and connect Rivian.
3. **Operate:** verify the runtime, secure access, configure optional providers, customize dashboards, and create a recovery package.

Riviamigo is designed to stay private. Its standard Compose origin listens on the host loopback interface. Use an authenticated HTTPS gateway for remote access; never forward the application port directly to the public internet.

## Installation path

1. [Prerequisites](./prerequisites.md) — confirm host, Docker, storage, browser, and network expectations.
2. [Install Riviamigo](./getting-started.md) — clone the repository, prepare the environment, and start the production stack.
3. [Configuration](./configuration.md) — understand required secrets and optional production settings.
4. [Rivian account setup](./rivian-account.md) — connect the vehicle account and handle MFA or login repair.
5. [Verify the installation](./verify-installation.md) — check container health, application access, ownership, and telemetry.
6. [Deployment and updates](./deployment.md) — operate, update, inspect, stop, and recover the stack.
7. [Secure deployment](./secure-deployment.md) — maintain the required authenticated access boundary.
8. [External connections](./external-connections.md) — choose weather, geocoding, basemap, and custom-provider policies.
9. [Dashboard customization](./dashboard-customization.md) — understand defaults, personal copies, editing, and recovery.
10. [Backup and restore](./backup-and-restore.md) — create and test complete recovery packages.

## When something fails

- A container will not become healthy: start with [Verify the installation](./verify-installation.md) and [Deployment and updates](./deployment.md).
- Rivian login or MFA fails: use [Rivian account setup](./rivian-account.md).
- The public address cannot connect or WebSockets fail: review [Secure deployment](./secure-deployment.md).
- A provider cannot connect: use [External connections](./external-connections.md).
- Recovery or backup validation fails: use [Backup and restore](./backup-and-restore.md) and the linked maintainer runbook.

For implementation details or maintainer procedures, continue to the [Development documentation](../development.md).
