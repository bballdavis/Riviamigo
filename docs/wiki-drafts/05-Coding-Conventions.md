# Coding Conventions

This page documents the standards contributors must follow in Riviamigo. Reviewers will request changes for violations of these conventions.

---

## Colors

All colors must use design tokens. This is a hard rule — PR reviewers will reject hex literals, `rgb()`/`rgba()`, named CSS colors, or arbitrary Tailwind values.

**Tailwind classes** — use semantic token classes:

```
bg-bg-elevated       text-fg-tertiary
border-accent        text-status-positive
bg-surface           text-fg-primary
```

**Never** use color utility classes like `text-blue-500`, `bg-indigo-700`, or `text-sky-400`. These bypass the theme system and break dark mode support.

**Inline styles and CSS** — use `var(--rm-*)` tokens:

```css
/* Good */
background: var(--rm-bg-elevated);
color: var(--rm-accent);

/* Opacity using color-mix */
background: color-mix(in oklab, var(--rm-accent) 50%, transparent);

/* Form controls */
accent-color: var(--rm-accent);
```

**Never** write `#1a1a1a`, `rgb(26, 26, 26)`, or `rgba(0,0,0,0.5)` in any `.tsx`, `.ts`, or `.css` file.

If a token you need does not exist, add a `--rm-*` entry to `packages/ui/src/tokens/globals.css` and bridge it in `apps/web/src/index.css`.

**Pre-PR grep check:**

```bash
grep -rE '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|-blue-|-indigo-|-sky-' apps/web/src packages/
```

---

## Dashboard Boundaries

The dashboard system has clear ownership boundaries. Do not mix responsibilities between layers.

| Layer | Owns |
|-------|------|
| Route files | Path declaration, params, mounting `DashboardPageShell` |
| `DashboardPageShell` | Auth guard, layout scaffold, dashboard config fetch, date range state, edit/view mode, action buttons |
| `DashboardRenderer` | Grid layout only — no slug checks, no page-specific logic |
| Widget components | Data fetch (own hook), rendering generic `@riviamigo/ui` components |

**Never** put `if (slug === "battery")` branches inside `DashboardRenderer`. Page-specific UI (hero panels, tabs, detail strips) is passed into the shell as composition, not baked into shared components.

---

## Widgets

Each widget should:

1. Call its own hook(s) — never reach into another widget's data.
2. Render generic `@riviamigo/ui` components — charts, tables, sensor chips.
3. Stay focused on one concern.

If multiple widgets on a page need the same derived data, extract a shared page-level hook or adapter. Do not duplicate fetch logic across widgets.

---

## Stat Cards (Sensor Chips)

Use the sensor chip pattern for stat cards. Define behavior in `sensorDefinitions.ts` using `componentType: "sensor"`. Do not create one-off TSX wrapper components for individual stats.

---

## Rust

### Database Queries

Always use `sqlx::query!()` or `sqlx::query_as!()` for database access. These are compile-time checked against the schema.

```rust
// Good
let row = sqlx::query_as!(VehicleRow, "SELECT id, name FROM riviamigo.vehicles WHERE id = $1", id)
    .fetch_one(&pool)
    .await?;

// Never — format! into SQL is SQL injection risk
let query = format!("SELECT {} FROM ...", user_input);
```

The only exception is the `metrics.rs` route, which has two `format!()` interpolations for `column` and `aggregate` — both are validated against an explicit allowlist before use.

### Error Handling for Tokens

Never use `.unwrap_or_default()` on Rivian token or credential fields. Use explicit `?` propagation or match on `Option`/`Result`. Silent defaults on auth fields hide bugs and can produce confusing behavior.

### Secrets in Logs

Never log token values, passwords, credentials, or age-encrypted blobs. Use `[REDACTED]` or omit the field entirely.

```rust
// Good
tracing::debug!("Processing auth for user_id={}", user_id);

// Never
tracing::debug!("Token: {}", access_token);
```

---

## Frontend Tests

- Test files belong in `apps/web/src/routes/__tests__/`.
- Mock all workspace packages with `vi.mock` at the top of the test file.
- Use `mockPrimitives` from `../../test/mockPrimitives` for common stubs.
- Stub charts, tables, and canvas-heavy components inline.
- The global test setup in `apps/web/src/test/setup.ts` stubs canvas, Path2D, ResizeObserver, and matchMedia for jsdom.

---

## Rust Tests

- Unit tests live in the same file as the code under test (`#[cfg(test)]` module).
- Integration tests that require a live database are marked:
  ```rust
  #[ignore = "requires DATABASE_URL"]
  ```
- Run integration tests with `cargo test -- --ignored` (requires a running database).

---

## Secrets and `.env`

- Never commit `.env` files to the repository. `.env` is in `.gitignore`.
- Never hardcode secrets, passwords, or API keys in source files.
- The `.env.example` file shows the required variables with placeholder values only.
