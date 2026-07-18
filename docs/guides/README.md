---
title: Getting Started
description: Prepare, install, configure, connect, and verify a Riviamigo installation.
slug: /getting-started/
sidebar_label: Getting Started
pagination_prev: null
pagination_next: guides/prerequisites
---

# Getting Started

This path takes a new self-hoster from an empty host to a verified, private Riviamigo installation. Work through it in order for a first installation. Ongoing ownership moves to the Using Riviamigo and Operations sections.

## Before you begin

Plan for three phases:

1. **Prepare:** confirm the host, Docker, persistent storage, network boundary, and required secrets.
2. **Install:** configure the Compose environment, start the stack, create the first owner, and connect Rivian.
3. **Verify:** confirm runtime health, application access, ownership, and telemetry.

Riviamigo is designed to stay private. Its standard Compose origin publishes port 8080, so use host firewall rules and an authenticated HTTPS gateway for remote access; never expose the application port directly to the public internet.

## Installation path

1. [Prerequisites](./prerequisites.md) — confirm host, Docker, storage, browser, and network expectations.
2. [Install Riviamigo](./getting-started.md) — clone the repository, prepare the environment, and start the production stack.
3. [Configuration](./configuration.md) — understand required secrets and optional production settings.
4. [Rivian account setup](./rivian-account.md) — connect the vehicle account and handle MFA or login repair.
5. [Verify the installation](./verify-installation.md) — check container health, application access, ownership, and telemetry.

After verification, continue to [Using Riviamigo](../using-riviamigo.md) for dashboards and external services or [Operations](../operations.md) for deployment, security, updates, and recovery.

## When something fails

- A container will not become healthy: start with [Verify the installation](./verify-installation.md) and the [Operations](../operations.md) troubleshooting path.
- Rivian login or MFA fails: use [Rivian account setup](./rivian-account.md).
- The public address cannot connect or WebSockets fail: review [Operations](../operations.md).
- A provider cannot connect: use [Using Riviamigo](../using-riviamigo.md).
- Recovery or backup validation fails: use [Operations](../operations.md) and the linked maintainer runbook.

For implementation details, continue to [Development](../development.md). For exact data contracts, use [Reference](../reference.md).
