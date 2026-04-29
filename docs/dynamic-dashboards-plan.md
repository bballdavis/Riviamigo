# Dynamic / Modular Dashboards — Implementation Plan

Author: planning agent
Audience: implementation agent (execute step-by-step)
Status: Ready to execute

---

## 1. Goal

Convert Riviamigo's currently-hardcoded route pages (`Dashboard`, `Battery`, `Efficiency`, `Charging`, `Trips`) into **data-driven, user-configurable dashboards** built from existing chart and stat-card "widgets."

Hard requirements:
- Default dashboards remain visually identical to today's pages.
- Default dashboards are admin-locked (read-only for normal users) but can be **cloned** by users to create their own.
- Users can add/remove/resize/reorder widgets in **edit mode**.
- A grid layout supports stretching widgets and "fill horizontal" on multi-select.
- Dashboards export/import as YAML.
- The heavy editing UI (drag/resize) **only loads in edit mode**; the view mode stays light (CSS grid only).

Non-goals (out of scope for v1):
- Custom per-widget query builders. Widgets are picked from a fixed registry.
- Cross-dashboard variables / parameters beyond the existing global date-range picker.
- Real-time collaborative editing.

---

## 2. Current State (anchors)

- Routes: [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx), [battery.tsx](apps/web/src/routes/battery.tsx), [efficiency.tsx](apps/web/src/routes/efficiency.tsx), [charging.tsx](apps/web/src/routes/charging.tsx), [trips.tsx](apps/web/src/routes/trips.tsx).
- Each page follows the same shape: `AuthGuard → AppLayout → PageLayout → StatCardGrid + MetricTabs(charts)`.
- Chart components live in [packages/ui/src/charts](packages/ui/src/charts/) (Soc, Range, PhantomDrain, Degradation, EfficiencyTrend, EfficiencyVsTemp, EnergyBar, ChargeCurve, SpeedProfile, ElevationProfile, TripMap, PhantomDrain).
- Stat primitives in [packages/ui/src/primitives](packages/ui/src/primitives/) (`StatCard`, `StatCardGrid`, `MetricTabs`, etc.).
- Data hooks in [packages/hooks/src](packages/hooks/src/) (`useSocHistory`, `useRangeHistory`, `usePhantomDrain`, `useDegradation`, `useEfficiencyTrend`, `useEfficiencyVsTemp`, `useEfficiencySummary`, `useEfficiencyByMode`, `useChargingSummary`, `useChargeSessions`, `useChargeCurve`, `useTrips`, `useTrip*`, `useSummaryStats`, `useVehicles`, `useAuth`).
- Backend: Rust/Axum + Postgres (Timescale). User table already exists (auth). No dashboard storage yet.
- API error shape: `{ error: { code, message } }` (per [project memory](../../.claude/projects/-Users-philipdavis-Repos-Riviamigo/memory/project_riviamigo.md)).

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Route (e.g. /battery, /d/:slug)                              │
│   <DashboardRenderer config={...} mode="view"|"edit" />      │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ DashboardRenderer                                            │
│  • View mode: pure CSS-grid render (no DnD libs)             │
│  • Edit mode (lazy): GridEditor with react-grid-layout       │
│  • Reads DashboardConfig (JSON), looks up widgets in         │
│    Widget Registry, hydrates with hooks, renders.            │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Widget Registry (id → { component, dataHook, defaultSize })  │
│  • stat.total_miles, chart.soc, chart.range, ...             │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│ Persistence: Rust API /v1/dashboards CRUD                    │
│  Stored as JSONB; YAML import/export at the edges only.      │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 DashboardConfig (TypeScript, source of truth)

Add to a new package: `packages/dashboards/src/schema.ts` (or under `packages/types`).

```ts
// packages/dashboards/src/schema.ts
export type WidgetId = string; // e.g. "chart.soc", "stat.total_miles"

export interface WidgetInstance {
  id: string;                  // uuid, stable across edits
  widgetId: WidgetId;          // registry key
  title?: string;              // override default title
  /** Grid placement: 12-col grid; rows are auto. */
  layout: { x: number; y: number; w: number; h: number };
  /** Per-instance widget options (e.g. tab key, color). */
  options?: Record<string, unknown>;
}

export interface DashboardConfig {
  schemaVersion: 1;
  id: string;                  // uuid
  slug: string;                // url-safe, unique per owner
  name: string;
  description?: string;
  isDefault: boolean;          // shipped/admin dashboard
  isLocked: boolean;           // admins prevent edits when true
  ownerId: string | null;      // null for system defaults
  /** Page-wide controls. */
  controls: { dateRange: boolean };
  widgets: WidgetInstance[];
}
```

Schema versioning is mandatory; bump `schemaVersion` on breaking change and write a migrator.

### 4.2 YAML representation

Same shape, serialised with `yaml` package. Round-trip test required:
`config → yaml → parse → config` must equal original.

```yaml
schemaVersion: 1
slug: battery
name: Battery
isDefault: true
isLocked: true
controls:
  dateRange: true
widgets:
  - id: 7c3...
    widgetId: stat.current_soc
    layout: { x: 0, y: 0, w: 3, h: 1 }
  - id: 9a1...
    widgetId: chart.soc
    layout: { x: 0, y: 1, w: 12, h: 4 }
```

### 4.3 Database (new migration)

```sql
CREATE TABLE dashboards (
  id          UUID PRIMARY KEY,
  owner_id    UUID NULL REFERENCES users(id) ON DELETE CASCADE, -- NULL = system default
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  config      JSONB NOT NULL,           -- full DashboardConfig
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)               -- NULL owner_id allowed by Postgres NULLS DISTINCT
);
CREATE INDEX dashboards_owner_idx ON dashboards (owner_id);

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'; -- 'user' | 'admin'
```

System defaults are seeded with `owner_id = NULL`, `is_default = true`, `is_locked = true`.

---

## 5. Widget Registry

Create `packages/dashboards/src/registry.tsx`:

```ts
export interface WidgetDef<O = unknown> {
  id: WidgetId;
  category: 'stat' | 'chart' | 'table';
  title: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  /** Hooks to call (returns ready data and loading flags). */
  useData: (ctx: WidgetCtx) => WidgetData;
  /** Pure render given resolved data. */
  render: (props: { data: WidgetData; options?: O }) => React.ReactNode;
  /** Optional options-form for the edit panel. */
  optionsSchema?: Zod schema;
}

export interface WidgetCtx {
  vehicleId: string | null;
  from: string; // ISO
  to: string;   // ISO
}
```

### 5.1 Initial widget catalog (seed exactly these — they map 1:1 to current pages)

| WidgetId | Wraps | Notes |
|---|---|---|
| `stat.total_miles` | `<StatCard>` + `useSummaryStats` | dashboard |
| `stat.total_trips` | StatCard + useSummaryStats | dashboard |
| `stat.energy_charged` | StatCard + useSummaryStats | dashboard |
| `stat.avg_efficiency` | StatCard + useSummaryStats | dashboard |
| `stat.current_soc` | StatCard + useSocHistory (latest) | battery |
| `stat.est_range` | StatCard + useRangeHistory (latest) | battery |
| `stat.phantom_drain_avg` | StatCard + usePhantomDrain | battery |
| `stat.capacity_health` | StatCard + useDegradation | battery |
| `chart.soc` | `<SocAreaChart>` + useSocHistory | |
| `chart.range` | RangeAreaChart + useRangeHistory | |
| `chart.phantom_drain` | PhantomDrainChart + usePhantomDrain | |
| `chart.degradation` | DegradationChart + useDegradation | |
| `chart.efficiency_trend` | EfficiencyTrendChart + useEfficiencyTrend | |
| `chart.efficiency_vs_temp` | EfficiencyVsTempChart + useEfficiencyVsTemp | |
| `chart.efficiency_by_mode` | EnergyBarChart + useEfficiencyByMode | |
| `chart.charge_curve` | ChargeCurveChart + useChargeCurve | charging detail |
| `table.charge_sessions` | new table widget + useChargeSessions | |
| `table.trips` | new table widget + useTrips | |

**Implementation note:** widget hook calls **must respect React rules of hooks** — every widget calls its hook unconditionally. The registry pattern is "one component per widget that internally calls its hook," not a `registry[id].useData()` lookup at runtime.

### 5.2 Widget component pattern

```tsx
// packages/dashboards/src/widgets/SocChartWidget.tsx
export function SocChartWidget({ ctx }: { ctx: WidgetCtx }) {
  const { data, isLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  return <SocAreaChart data={...} loading={isLoading} height="100%" />;
}
```

Charts must accept fluid heights (`height="100%"`) so they fill grid cells. Audit current chart components — many take a fixed `height={240}`. Add a fluid-height code path; default remains 240 for backward compat with existing direct usages.

---

## 6. Grid System

### 6.1 View mode (default, lightweight)

Plain CSS grid, no JS layout libs:

```tsx
<div className="grid grid-cols-12 auto-rows-[80px] gap-4">
  {widgets.map(w => (
    <div
      key={w.id}
      style={{ gridColumn: `${w.layout.x+1} / span ${w.layout.w}`,
               gridRow:    `${w.layout.y+1} / span ${w.layout.h}` }}
    >
      <WidgetHost instance={w} ctx={ctx} />
    </div>
  ))}
</div>
```

No drag handles, no resize observers. SSR/hydration-safe.

### 6.2 Edit mode (lazy-loaded)

Use **react-grid-layout** (`react-grid-layout` + `react-resizable`). Code-split it:

```tsx
const GridEditor = React.lazy(() => import('./GridEditor'));
{mode === 'edit' && <Suspense fallback={...}><GridEditor ... /></Suspense>}
```

Editor responsibilities:
- Drag, resize, snap to 12-col grid.
- Multi-select widgets (shift-click).
- **"Fill horizontal" action**: when ≥2 widgets are selected on the same row, evenly distribute their `w` to fill 12 columns and align `x`.
- Widget palette (sidebar) listing registry items; drag in to add.
- Per-widget options panel (renders from `optionsSchema`).
- Title/description editor.
- Save / Cancel / Reset to default.

**Why lazy:** keeps `react-grid-layout` (~80 kB gz) out of the everyday view bundle.

### 6.3 Multi-select fill behavior (spec)

```
Given selection S of widgets with the same y-row:
  total_w = 12
  per = floor(12 / |S|)
  remainder = 12 - per * |S|
  Sort S by current x ascending.
  Assign widths: first `remainder` get per+1, rest get per.
  Walk x left-to-right, packing them to be contiguous.
```

If selection spans multiple rows, disable the action with a tooltip.

---

## 7. Routing

Two URL patterns coexist:

- `/` (dashboard), `/battery`, `/efficiency`, `/charging`, `/trips` — render the **system-default** dashboard with matching slug.
- `/d/:slug` — render a user dashboard owned by current user (or system default fallback).
- `/d/:slug?edit=1` — open edit mode (must be owner OR admin editing a default).

The legacy route files (`battery.tsx` etc.) become thin shims that load the seeded default config and render `<DashboardRenderer />`. The "implement once, configure many" payoff lives there.

---

## 8. Backend (Rust API)

New module `apps/api/src/dashboards/`:

- `mod.rs` — module wiring
- `models.rs` — `Dashboard`, `DashboardConfig` (serde)
- `repo.rs` — sqlx queries
- `routes.rs` — handlers
- `seed.rs` — system default seeder

### 8.1 Endpoints (under `/v1`, JWT-protected unless noted)

| Method | Path | Description |
|---|---|---|
| GET    | `/dashboards` | list current user's dashboards + visible system defaults |
| GET    | `/dashboards/:id` | fetch one |
| GET    | `/dashboards/by-slug/:slug` | resolve route slug → config (user override > default) |
| POST   | `/dashboards` | create user dashboard |
| PUT    | `/dashboards/:id` | update (config + name) |
| DELETE | `/dashboards/:id` | delete user dashboard |
| POST   | `/dashboards/:id/clone` | clone (default → user copy) |
| POST   | `/admin/dashboards/:id/lock` | admin: set is_locked |
| PUT    | `/admin/dashboards/:id` | admin: edit a system default |

Authorization rules:
- Non-admin cannot mutate `is_default = true` or `owner_id IS NULL` rows.
- Non-admin cannot mutate dashboards they don't own.
- Admins gated by `users.role = 'admin'`. Add an `AdminGuard` extractor.

### 8.2 Validation
- Reject configs whose `schemaVersion` is unknown.
- Validate every `widgetId` against a server-side allow-list (mirror of registry; generate from a shared JSON during build, OR keep it in the migration as a `CHECK` against a `widget_ids` table — pick: shared JSON, simpler).
- Reject overlapping layouts? Optional v1: allow them, the editor avoids them. Add a `validate_layout` helper but only warn.

### 8.3 Seeding system defaults
On first boot, run `seed::ensure_defaults()` which idempotently upserts five rows (slugs: `dashboard`, `battery`, `efficiency`, `charging`, `trips`) with configs that exactly reproduce today's pages. Seed JSON lives in `apps/api/src/dashboards/defaults/*.json` and is `include_str!`'d.

---

## 9. YAML Import / Export

Frontend-only feature using `yaml` npm package (no server YAML parsing — server is JSON only).

- **Export:** "Export YAML" button in edit mode → downloads `<slug>.yaml`.
- **Import:** "Import YAML" → file picker → parse → validate via Zod schema → preview diff → `POST /dashboards`.
- Strip server-managed fields on export (`id`, `ownerId`, timestamps); regenerate on import.
- Include a `# Riviamigo dashboard vN` header comment for human readers.

---

## 10. Admin UX

Add `/admin/dashboards` route (visible only to `role=admin`):

- List all system defaults.
- Toggle `is_locked` per dashboard.
- "Edit default" → opens edit mode with admin privileges.
- Audit log table optional (skip v1).

For non-admin users viewing a locked default:
- Edit button is replaced with **"Customize"** → calls `/clone` → navigates to `/d/<new-slug>?edit=1`.

---

## 11. Frontend Package Layout

New package: `packages/dashboards/`

```
packages/dashboards/
  package.json
  src/
    index.ts
    schema.ts                  # types + Zod
    registry.tsx               # widget registry
    widgets/
      stat/*.tsx               # one file per stat widget
      chart/*.tsx              # one file per chart widget
      table/*.tsx
    DashboardRenderer.tsx      # view-mode renderer
    GridEditor.tsx             # edit-mode (lazy import target)
    yaml.ts                    # import/export helpers
    api.ts                     # fetch wrappers
    hooks.ts                   # useDashboard(slug), useUpdateDashboard
```

Add to root `package.json` workspaces (already pnpm/yarn workspace — confirm). Wire into `apps/web` via path alias `@riviamigo/dashboards`.

---

## 12. Migration Strategy (route-by-route)

Do not migrate all five pages at once. Order, with verification gate between each:

1. **Plumbing only**: package scaffold, schema, registry skeleton, DB migration, API CRUD, seeder for the `dashboard` (home) slug. Wire `/` route through `DashboardRenderer` in **view mode**. **Visual regression check**: home page pixel-identical.
2. **Battery** route migration. Same gate.
3. **Efficiency**, **Charging**, **Trips** — one PR each.
4. **Edit mode** lands as its own PR after all five routes are config-driven. (Until then, dashboards are technically dynamic but editing is admin/dev only via API.)
5. **Admin UI** + clone flow.
6. **YAML import/export.**

This keeps each PR reviewable and lets you ship in safe increments.

---

## 13. Testing

### Required tests (each PR):
- **Unit**: registry resolves all widget ids; YAML round-trip; layout fill-horizontal math; schema Zod validators reject malformed configs.
- **Component**: `DashboardRenderer` renders a fixture config; widgets receive correct ctx; `MetricTabs`-equivalent multi-chart widgets still tab.
- **Integration (Rust)**: CRUD endpoints, role gating (non-admin cannot edit defaults), clone copies config, slug uniqueness per-owner. Use existing testcontainers Postgres harness — see [project memory](../../.claude/projects/-Users-philipdavis-Repos-Riviamigo/memory/project_riviamigo.md).
- **Visual regression**: each migrated route must match pre-migration screenshots within tolerance. Add Playwright snapshot tests in `apps/web/e2e/dashboards.spec.ts`.
- **Bundle size**: assert `react-grid-layout` not in the main chunk (e.g. with `rollup-plugin-visualizer` or a CI check parsing `dist/stats.html`).

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Charts assume fixed pixel heights → break in fluid grid | Audit + add `height="100%"` path; default unchanged. |
| Hooks called conditionally if widgets unmount mid-render | One component per widget; hook called at top of that component. |
| `react-grid-layout` bloats main bundle | Lazy-import in edit mode only; CI bundle assertion. |
| YAML config drift vs JSON schema | Single Zod schema; YAML helper just (de)serialises. Round-trip test in CI. |
| Admin escalation via crafted PUT | Server-side role check on every default-touching endpoint; never trust `is_default` from request body. |
| User clones a default, then we ship a new widget — their copy is stale | Acceptable in v1. Track `clonedFromVersion` in config; show a "default updated" badge later. |

---

## 15. Out-of-Scope (note for follow-ups)

- Sharing dashboards between users.
- Public/embed links.
- Per-widget custom queries / SQL.
- Alerting on thresholds.
- Mobile drag editing (edit mode is desktop-only in v1; view mode is responsive).

---

## 16. Definition of Done

- All five existing pages render via `DashboardRenderer` from seeded configs and are visually unchanged.
- Non-admin users can clone any default, edit, save, and reload their copy.
- Admins can edit system defaults and lock/unlock them.
- YAML export of any dashboard, edited offline, re-imports cleanly and renders identically.
- Edit-mode JS chunks are not loaded on view-only navigations (verified by network panel + bundle stats).
- All listed tests pass in CI.

---

## 17. Suggested PR Sequence (concrete)

1. `feat(dashboards): scaffold package + schema + Zod` — no behavior change.
2. `feat(api): dashboards table, CRUD, seed home default`.
3. `feat(web): render home via DashboardRenderer (view-only)`.
4. `feat(web): migrate battery/efficiency/charging/trips routes` (one PR each, 4 PRs).
5. `feat(dashboards): GridEditor (lazy)` + edit toggle on `/d/:slug?edit=1`.
6. `feat(api,web): clone flow + admin lock`.
7. `feat(dashboards): YAML import/export`.
8. `feat(web): /admin/dashboards page`.

Each PR ships green tests and a screenshot in the description.
