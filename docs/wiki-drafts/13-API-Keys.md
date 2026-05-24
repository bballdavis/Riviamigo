# API Keys

Riviamigo supports API keys for programmatic access to the REST API. Use API keys for scripts, home automation integrations, Grafana, or any tool that needs to query your telemetry data without a browser session.

---

## Key Format

All API keys begin with the `rmigo_` prefix, followed by a random token. Example:

```
rmigo_7f3a9c2d1e8b4f6a0d5c2e9b7f1a3d8c
```

> ⚠️ **Security note:** API keys are shown **once** at creation and then never again. Copy the key immediately and store it in a password manager or secret store. If you lose it, you must revoke it and create a new one.

---

## Creating an API Key

### Via the web UI

1. Log in to Riviamigo.
2. Navigate to **Settings → API Keys**.
3. Click **New API Key**.
4. Give the key a name (e.g., `home-assistant`, `grafana`, `my-script`).
5. Copy the displayed key — it will not be shown again.

### Via the REST API

```bash
curl -X POST http://localhost:3001/v1/api-keys \
  -H "Authorization: Bearer <your JWT token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-script"}'
```

Response:

```json
{
  "id": "...",
  "name": "my-script",
  "key": "rmigo_7f3a9c2d1e8b4f6a0d5c2e9b7f1a3d8c",
  "created_at": "2025-01-01T00:00:00Z"
}
```

The `key` field is returned only in this response. The raw key value is never stored — only a SHA256 hash is kept in the database.

---

## Using an API Key

Pass the key as a Bearer token in the `Authorization` header:

```bash
curl http://localhost:3001/v1/vehicles \
  -H "Authorization: Bearer rmigo_7f3a9c2d1e8b4f6a0d5c2e9b7f1a3d8c"
```

API keys work on all protected endpoints — the same routes accessible with a JWT access token.

---

## Rate Limits

API keys are subject to the same rate limits as regular authenticated sessions:

- **Burst**: 20 requests
- **Sustained**: approximately 120 requests per minute

If you exceed the limit, the API returns `429 Too Many Requests`. Back off and retry after a short delay.

---

## Listing API Keys

Via the web UI: **Settings → API Keys** shows all active keys with their name and creation date.

Via the API:

```bash
curl http://localhost:3001/v1/api-keys \
  -H "Authorization: Bearer <token>"
```

---

## Revoking an API Key

### Via the web UI

1. Go to **Settings → API Keys**.
2. Find the key you want to revoke.
3. Click **Delete**.

### Via the REST API

```bash
curl -X DELETE http://localhost:3001/v1/api-keys/<key-id> \
  -H "Authorization: Bearer <token>"
```

Revocation takes effect immediately. Any requests using the revoked key will receive `401 Unauthorized`.

---

## Security Notes

- Keys are stored as SHA256 hashes — a compromised database does not expose the raw key values.
- Treat API keys like passwords. Do not commit them to version control or share them in logs.
- Create separate keys for each integration so you can revoke one without affecting others.
- There is currently no key expiration or scope restriction — all keys have full read/write access to the API.
