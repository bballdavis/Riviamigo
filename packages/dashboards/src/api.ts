import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@riviamigo/hooks';
import { DashboardConfigSchema } from './schema';
import type { DashboardConfig } from './schema';

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

  return DashboardConfigSchema.parse({
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
