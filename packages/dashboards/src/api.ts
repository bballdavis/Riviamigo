import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@riviamigo/hooks';
import { DashboardConfigSchema } from './schema';
import type { DashboardConfig, WidgetInstance } from './schema';

const BASE = '/v1/dashboards';

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

async function apiFetch<T>(
  url: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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

  return parsed.slug === 'charging' ? normalizeChargingConnectionSwap(parsed) : parsed;
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
  'custom:charging.connection',
]);

const CHARGING_SWAP_WIDGETS: WidgetInstance[] = [
  chargingWidget('d4000004-0000-0000-0000-000000000001', 'sessions', 'Sessions', {}, { x: 0, y: 0, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000002', 'total_energy', 'Total Energy', {}, { x: 3, y: 0, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000003', 'total_cost', 'Total Cost', {}, { x: 3, y: 2, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000004', 'avg_session', 'Avg / Session', unpluggedOptions(), { x: 9, y: 2, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000005', 'charging_cycles', 'Charging Cycles', {}, { x: 0, y: 2, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000006', 'charge_efficiency', 'Charge Efficiency', unpluggedOptions(), { x: 9, y: 0, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000007', 'max_charge_rate', 'Max Charge Rate', unpluggedOptions(), { x: 6, y: 2, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000008', 'max_charge_limit', 'Max Charge Limit', unpluggedOptions(), { x: 6, y: 0, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000009', 'home_share', 'Home Charging', {}, { x: 0, y: 4, w: 3, h: 2 }),
  chargingWidget('d4000004-0000-0000-0000-000000000010', 'dc_share', 'DC Fast Charging', {}, { x: 3, y: 4, w: 3, h: 2 }),
  customWidget('d4000004-0000-0000-0000-000000000013', 'charging.connection', 'Charging Connection', pluggedOptions(), { x: 6, y: 0, w: 6, h: 6 }),
];

function normalizeChargingConnectionSwap(config: DashboardConfig): DashboardConfig {
  const preserved = config.widgets.filter((widget) => !CHARGING_SWAP_WIDGET_KEYS.has(`${widget.componentType}:${widget.definitionId}`));
  return { ...config, widgets: [...CHARGING_SWAP_WIDGETS, ...preserved] };
}

function chargingWidget(
  id: string,
  definitionId: string,
  title: string,
  options: Record<string, unknown>,
  layout: WidgetInstance['layout'],
): WidgetInstance {
  return { id, componentType: 'charging', definitionId, title, options, layout };
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

function pluggedOptions() {
  return { [CHARGING_CONNECTION_VISIBILITY_OPTION]: 'plugged' };
}

function unpluggedOptions() {
  return { [CHARGING_CONNECTION_VISIBILITY_OPTION]: 'unplugged' };
}

function dashboardMutationBody(config: DashboardConfig) {
  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    config,
  };
}

export function useDashboards() {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig[]>({
    queryKey: ['dashboards'],
    queryFn: async () => {
      const records = await apiFetch<unknown[]>(BASE, accessToken);
      return records.map(normalizeDashboardConfig);
    },
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardBySlug(slug: string | null) {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig>({
    queryKey: ['dashboards', 'slug', slug],
    queryFn: async () => normalizeDashboardConfig(await apiFetch(`${BASE}/by-slug/${slug}`, accessToken)),
    enabled: !!accessToken && !!slug,
    placeholderData: (previous) => previous,
  });
}

export function useCreateDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiFetch<unknown>(BASE, accessToken, {
        method: 'POST',
        body: JSON.stringify(dashboardMutationBody(config)),
      }).then(normalizeDashboardConfig),
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useUpdateDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiFetch<unknown>(`${BASE}/${config.id}`, accessToken, {
        method: 'PUT',
        body: JSON.stringify(dashboardMutationBody(config)),
      }).then(normalizeDashboardConfig),
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useUpdateAdminDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiFetch<unknown>(`/v1/admin/dashboards/${config.id}`, accessToken, {
        method: 'PUT',
        body: JSON.stringify({ name: config.name, description: config.description, config }),
      }).then(normalizeDashboardConfig),
    onSuccess: (_data: DashboardConfig, variables: DashboardConfig) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', variables.slug] });
    },
  });
}

export function useDeleteDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${BASE}/${id}`, accessToken, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useCloneDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`${BASE}/${id}/clone`, accessToken, { method: 'POST' }).then(normalizeDashboardConfig),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}
