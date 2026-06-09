import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, api } from '@riviamigo/hooks';
import { DashboardConfigSchema } from './schema';
import { sanitizeDashboardConfig } from './layout';
import type { DashboardConfig, WidgetInstance } from './schema';

const BASE = '/v1/dashboards';
const DASHBOARD_QUERY_STALE_TIME_MS = 60 * 60 * 1000;

interface DashboardRecord {
  id?: string;
  owner_id?: string | null;
  ownerId?: string | null;
  slug?: string;
  name?: string;
  description?: string | null;
  is_default?: boolean;
  isDefault?: boolean;
  is_locked?: boolean;
  isLocked?: boolean;
  config?: unknown;
}


export function normalizeDashboardConfig(raw: unknown): DashboardConfig {
  const record = raw as DashboardRecord;
  const config = (
    record && typeof record === 'object' && record.config && typeof record.config === 'object'
      ? record.config
      : raw
  ) as Partial<DashboardConfig>;

  const parsed = DashboardConfigSchema.parse({
    ...config,
    id: record.id ?? config.id,
    slug: record.slug ?? config.slug,
    name: record.name ?? config.name,
    description: record.description ?? config.description ?? undefined,
    isDefault: record.isDefault ?? record.is_default ?? config.isDefault,
    isLocked: record.isLocked ?? record.is_locked ?? config.isLocked,
    ownerId: record.ownerId ?? record.owner_id ?? config.ownerId ?? null,
    controls: config.controls ?? { dateRange: true },
    widgets: Array.isArray(config.widgets) ? config.widgets : [],
  });

  const normalized = parsed.slug === 'charging' ? normalizeChargingConnectionSwap(parsed) : parsed;
  return sanitizeDashboardConfig(normalized);
}

const CHARGING_CONNECTION_VISIBILITY_OPTION = 'chargingConnectionVisibility';

const CHARGING_SWAP_WIDGET_KEYS = new Set([
  'charging:sessions',
  'charging:total_energy',
  'charging:total_cost',
  'charging:avg_session',
  'charging:charging_cycles',
  'charging:charge_efficiency',
  'charging:max_charge_rate',
  'charging:max_charge_limit',
  'charging:home_share',
  'charging:dc_share',
  'sensor:charging_sessions_summary',
  'sensor:charging_total_energy',
  'sensor:charging_total_cost',
  'sensor:charging_avg_session',
  'sensor:charging_cycles_summary',
  'sensor:charging_efficiency_summary',
  'sensor:charging_max_rate',
  'sensor:charging_max_limit',
  'sensor:charging_home_share',
  'sensor:charging_dc_share',
  'sensor:charging_free_sessions',
  'sensor:charging_range_added',
  'custom:charging.connection',
  'custom:charging.sessions.table',
  'custom:charging.network_breakdown',
  'chart:catalog',
]);

const CHARGING_SWAP_WIDGETS: WidgetInstance[] = [
  // Always-visible stat chips (left 6 columns)
  sensorWidget('d4000004-0000-0000-0000-000000000001', 'charging_sessions_summary', 'Sessions', {}, { x: 0, y: 0, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000002', 'charging_total_energy', 'Total Energy', {}, { x: 3, y: 0, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000005', 'charging_cycles_summary', 'Charging Cycles', {}, { x: 0, y: 2, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000003', 'charging_total_cost', 'Total Cost', {}, { x: 3, y: 2, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000009', 'charging_home_share', 'Home Charging', {}, { x: 0, y: 4, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000010', 'charging_dc_share', 'DC Fast Charging', {}, { x: 3, y: 4, w: 3, h: 2 }),
  // Plugged-in: connection widget spans x:6-11, y:0-5.
  customWidget('d4000004-0000-0000-0000-000000000013', 'charging.connection', 'Charging Connection', pluggedOptions(), { x: 6, y: 0, w: 6, h: 6 }),
  // Unplugged-only: stat chips at the same grid cells as the connection widget above
  sensorWidget('d4000004-0000-0000-0000-000000000006', 'charging_efficiency_summary', 'Charge Efficiency', unpluggedOptions(), { x: 6, y: 0, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000008', 'charging_max_limit', 'Max Charge Limit', unpluggedOptions(), { x: 9, y: 0, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000007', 'charging_max_rate', 'Max Charge Rate', unpluggedOptions(), { x: 6, y: 2, w: 3, h: 2 }),
  sensorWidget('d4000004-0000-0000-0000-000000000004', 'charging_avg_session', 'Avg / Session', unpluggedOptions(), { x: 9, y: 2, w: 3, h: 2 }),
  // Keep network enrichment below the session table so the primary chart row stays full-width.
  chartWidget('d4000004-0000-0000-0000-000000000011', 'catalog', 'Charging Charts', {
    page: 'charging',
    chartId: 'charging-sessions-energy',
    chartIds: ['charging-sessions-energy', 'charge-level', 'charging-weekly-energy', 'charging-curve-analysis'],
    showPicker: true,
  }, { x: 0, y: 6, w: 12, h: 11 }),
  customWidget('d4000004-0000-0000-0000-000000000012', 'charging.sessions.table', 'Charging Sessions', {}, { x: 0, y: 17, w: 12, h: 12 }),
  customWidget('d4000004-0000-0000-0000-000000000016', 'charging.network_breakdown', 'Network Breakdown', {}, { x: 0, y: 29, w: 12, h: 4 }),
];

function normalizeChargingConnectionSwap(config: DashboardConfig): DashboardConfig {
  // Build a set of widget IDs already in the saved config so user edits are preserved.
  const existingIds = new Set(config.widgets.map((w) => w.id));

  // Only inject defaults that the user hasn't already saved (by ID).
  const missingDefaults = CHARGING_SWAP_WIDGETS.filter((w) => !existingIds.has(w.id));

  // Strip any legacy hard-coded widgets the user hasn't touched, then prepend the
  // missing defaults. Widgets the user has edited (same UUID) are kept in place.
  const userWidgets = config.widgets.filter((w) => {
    const key = `${w.componentType}:${w.definitionId}`;
    // Keep user widget if it's NOT a swap widget, OR if it IS a swap widget that
    // was already present in the saved config (meaning the user edited it).
    return !CHARGING_SWAP_WIDGET_KEYS.has(key) || existingIds.has(w.id);
  });

  return { ...config, widgets: [...missingDefaults, ...userWidgets] };
}

function sensorWidget(
  id: string,
  definitionId: string,
  title: string,
  options: Record<string, unknown>,
  layout: WidgetInstance['layout'],
): WidgetInstance {
  return { id, componentType: 'sensor', definitionId, title, options, layout };
}

function customWidget(
  id: string,
  definitionId: string,
  title: string,
  options: Record<string, unknown>,
  layout: WidgetInstance['layout'],
): WidgetInstance {
  return { id, componentType: 'custom', definitionId, title, options, layout };
}

function chartWidget(
  id: string,
  definitionId: string,
  title: string,
  options: Record<string, unknown>,
  layout: WidgetInstance['layout'],
): WidgetInstance {
  return { id, componentType: 'chart', definitionId, title, options, layout };
}

function pluggedOptions() {
  return { [CHARGING_CONNECTION_VISIBILITY_OPTION]: 'plugged' };
}

function unpluggedOptions() {
  return { [CHARGING_CONNECTION_VISIBILITY_OPTION]: 'unplugged' };
}

function dashboardMutationBody(config: DashboardConfig) {
  const sanitized = sanitizeDashboardConfig(config);
  return {
    slug: sanitized.slug,
    name: sanitized.name,
    description: sanitized.description,
    config: sanitized,
  };
}

export function useDashboards() {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig[]>({
    queryKey: ['dashboards'],
    queryFn: async () => {
      const records = await api.apiFetch<unknown[]>('GET', BASE);
      return records.map(normalizeDashboardConfig);
    },
    enabled: !!accessToken,
    staleTime: DASHBOARD_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardBySlug(slug: string | null) {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig>({
    queryKey: ['dashboards', 'slug', slug],
    queryFn: async () => normalizeDashboardConfig(await api.apiFetch(`GET`, `${BASE}/by-slug/${slug}`)),
    enabled: !!accessToken && !!slug,
    staleTime: DASHBOARD_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      api.apiFetch<unknown>('POST', BASE, dashboardMutationBody(config))
        .then(normalizeDashboardConfig),
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useUpdateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      api.apiFetch<unknown>('PUT', `${BASE}/${config.id}`, dashboardMutationBody(config))
        .then(normalizeDashboardConfig),
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useUpdateAdminDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) => {
      const sanitized = sanitizeDashboardConfig(config);
      return api.apiFetch<unknown>('PUT', `/v1/admin/dashboards/${sanitized.id}`, {
        name: sanitized.name,
        description: sanitized.description,
        config: sanitized,
      }).then(normalizeDashboardConfig);
    },
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useSetAdminDashboardLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      api.apiFetch<unknown>('POST', `/v1/admin/dashboards/${id}/lock`, { locked })
        .then(normalizeDashboardConfig),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', data.slug] });
    },
  });
}

export function useRestoreAdminDashboardDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.apiFetch<unknown>('POST', `/v1/admin/dashboards/${id}/restore-default`)
        .then(normalizeDashboardConfig),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', data.slug] });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiFetch<void>('DELETE', `${BASE}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useCloneDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.apiFetch<unknown>('POST', `${BASE}/${id}/clone`).then(normalizeDashboardConfig),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}
