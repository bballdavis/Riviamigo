import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthReady, api } from '@riviamigo/hooks';
import { DashboardConfigSchema } from './schema';
import { sanitizeDashboardConfig } from './layout';
import type { DashboardConfig } from './schema';
import { migrateLegacyWidgetVisibility } from './dashboardVisibility';

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

  const normalized = parsed.slug === 'charging'
    ? normalizeChargingDashboardWidgetHeights(parsed)
    : parsed;
  return sanitizeDashboardConfig(normalizeLegacyDashboardConfig(normalized));
}

function normalizeLegacyDashboardConfig(config: DashboardConfig): DashboardConfig {
  const tripsNormalized = normalizeLegacyTripStatWidgets(config);
  return {
    ...tripsNormalized,
    widgets: tripsNormalized.widgets.map(migrateLegacyWidgetVisibility),
  };
}

const LEGACY_TRIP_STAT_TO_SENSOR: Record<string, string> = {
  miles: 'trip_miles',
  count: 'total_trips',
  efficiency: 'avg_efficiency',
  duration: 'avg_trip_duration',
};

const TRIP_SENSOR_DEFINITION_IDS = new Set([
  'trip_miles',
  'total_trips',
  'avg_efficiency',
  'avg_trip_duration',
]);

function normalizeLegacyTripStatWidgets(config: DashboardConfig): DashboardConfig {
  return {
    ...config,
    widgets: config.widgets.map((widget) => {
      if (widget.componentType !== 'custom' || widget.definitionId !== 'trips.stat') {
        return widget;
      }

      const legacyOptions = (widget.options ?? {}) as Record<string, unknown>;
      const metric = typeof legacyOptions.metric === 'string' ? legacyOptions.metric : null;
      const stat = typeof legacyOptions.stat === 'string' ? legacyOptions.stat : null;
      const definitionId = metric && TRIP_SENSOR_DEFINITION_IDS.has(metric)
        ? metric
        : stat
          ? LEGACY_TRIP_STAT_TO_SENSOR[stat]
          : undefined;

      if (!definitionId) return widget;

      const sensorOptions = { ...legacyOptions };
      delete sensorOptions.stat;
      delete sensorOptions.metric;
      const valueMode = definitionId === 'trip_miles' || definitionId === 'total_trips'
        ? 'sum'
        : definitionId === 'avg_trip_duration'
          ? 'avg'
          : undefined;

      return {
        ...widget,
        componentType: 'sensor' as const,
        definitionId,
        options: {
          ...sensorOptions,
          metric: definitionId,
          ...(valueMode ? { valueMode } : {}),
          tripSelectionAware: true,
        },
      };
    }),
  };
}

const CHARGING_NETWORK_BREAKDOWN_MIN_H = 1;
const CHARGING_NETWORK_BREAKDOWN_MAX_H = 20;

function normalizeChargingDashboardWidgetHeights(config: DashboardConfig): DashboardConfig {
  return {
    ...config,
    widgets: config.widgets.map((widget) => {
      if (
        widget.componentType !== 'custom' ||
        widget.definitionId !== 'charging.network_breakdown'
      ) return widget;

      const nextHeight = clampBreakdownHeight(widget.layout.h);
      if (nextHeight === widget.layout.h) return widget;

      return {
        ...widget,
        layout: {
          ...widget.layout,
          h: nextHeight,
        },
      };
    }),
  };
}

function clampBreakdownHeight(height: number): number {
  if (!Number.isFinite(height)) return CHARGING_NETWORK_BREAKDOWN_MAX_H;
  return Math.max(CHARGING_NETWORK_BREAKDOWN_MIN_H, Math.min(CHARGING_NETWORK_BREAKDOWN_MAX_H, Math.round(height)));
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

function writeDashboardCache(qc: QueryClient, dashboard: DashboardConfig) {
  qc.setQueryData<DashboardConfig>(['dashboards', 'id', dashboard.id], dashboard);
  qc.setQueryData<DashboardConfig>(['dashboards', 'slug', dashboard.slug], (current) => {
    if (current?.ownerId && !dashboard.ownerId) return current;
    return dashboard;
  });
  qc.setQueryData<DashboardConfig[]>(['dashboards'], (current) => {
    if (!current) return current;
    const next = current.filter((entry) => (
      entry.id !== dashboard.id &&
      !(entry.slug === dashboard.slug && entry.ownerId === dashboard.ownerId)
    ));
    next.push(dashboard);
    return sortDashboardList(next);
  });
}

function removeDashboardFromCache(qc: QueryClient, id: string) {
  qc.removeQueries({ queryKey: ['dashboards', 'id', id], exact: true });
  qc.setQueryData<DashboardConfig[]>(['dashboards'], (current) =>
    current ? current.filter((entry) => entry.id !== id) : current
  );
}

function sortDashboardList(dashboards: DashboardConfig[]) {
  return dashboards.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function useDashboards() {
  const authReady = useAuthReady();
  return useQuery<DashboardConfig[]>({
    queryKey: ['dashboards'],
    queryFn: async () => {
      const records = await api.apiFetch<unknown[]>('GET', BASE);
      return records.map(normalizeDashboardConfig);
    },
    enabled: authReady,
    staleTime: DASHBOARD_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardBySlug(slug: string | null) {
  const authReady = useAuthReady();
  return useQuery<DashboardConfig>({
    queryKey: ['dashboards', 'slug', slug],
    queryFn: async () => normalizeDashboardConfig(await api.apiFetch(`GET`, `${BASE}/by-slug/${slug}`)),
    enabled: authReady && !!slug,
    staleTime: DASHBOARD_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardById(id: string | null) {
  const authReady = useAuthReady();
  return useQuery<DashboardConfig>({
    queryKey: ['dashboards', 'id', id],
    queryFn: async () => normalizeDashboardConfig(await api.apiFetch(`GET`, `${BASE}/${id}`)),
    enabled: authReady && !!id,
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
    onSuccess: (data: DashboardConfig, variables: DashboardConfig) => {
      writeDashboardCache(qc, data);
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
    onSuccess: (data: DashboardConfig, variables: DashboardConfig) => {
      writeDashboardCache(qc, data);
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
    onSuccess: (data: DashboardConfig, variables: DashboardConfig) => {
      writeDashboardCache(qc, data);
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
      writeDashboardCache(qc, data);
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
      writeDashboardCache(qc, data);
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', data.slug] });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiFetch<void>('DELETE', `${BASE}/${id}`),
    onSuccess: (_data, id) => {
      removeDashboardFromCache(qc, id);
      qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
}

export function useCloneDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.apiFetch<unknown>('POST', `${BASE}/${id}/clone`).then(normalizeDashboardConfig),
    onSuccess: (data) => {
      writeDashboardCache(qc, data);
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      qc.invalidateQueries({ queryKey: ['dashboards', 'slug', data.slug] });
    },
  });
}
