import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@riviamigo/hooks';
import type { DashboardConfig } from './schema';

const BASE = '/v1/dashboards';

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
  return res.json() as Promise<T>;
}

export function useDashboards() {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig[]>({
    queryKey: ['dashboards'],
    queryFn: () => apiFetch(BASE, accessToken),
    enabled: !!accessToken,
  });
}

export function useDashboardBySlug(slug: string | null) {
  const { accessToken } = useAuth();
  return useQuery<DashboardConfig>({
    queryKey: ['dashboards', 'slug', slug],
    queryFn: () => apiFetch(`${BASE}/by-slug/${slug}`, accessToken),
    enabled: !!accessToken && !!slug,
  });
}

export function useCreateDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiFetch<DashboardConfig>(BASE, accessToken, {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useUpdateDashboard() {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiFetch<DashboardConfig>(`${BASE}/${config.id}`, accessToken, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
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
      apiFetch<DashboardConfig>(`${BASE}/${id}/clone`, accessToken, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}
