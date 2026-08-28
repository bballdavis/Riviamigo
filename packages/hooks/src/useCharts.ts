import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChartDefinitionV1,
  ChartManagerEntry,
  ChartRecord,
  ChartSourceManifest,
} from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import { useAuth } from './useAuth';

const CHARTS_BASE = '/v1/charts';
const CHART_SOURCES_BASE = '/v1/chart-sources';
const CHART_QUERY_STALE_TIME_MS = 5 * 60 * 1000;

export interface ChartRecordInput {
  slug: string;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  config: ChartDefinitionV1;
}

export interface ChartUpdateInput extends ChartRecordInput {
  id: string;
}

export interface ChartPlacementUpdate {
  id: string;
  placements: Array<{ dashboardSlug: string }>;
}

export interface ChartEnabledUpdate {
  id: string;
  isEnabled: boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord, camel: string, snake: string): string | null {
  const value = record[camel] ?? record[snake];
  return typeof value === 'string' ? value : null;
}

function readBoolean(record: JsonRecord, camel: string, snake: string, fallback: boolean): boolean {
  const value = record[camel] ?? record[snake];
  return typeof value === 'boolean' ? value : fallback;
}

function readNullableString(record: JsonRecord, camel: string, snake: string): string | null {
  const value = record[camel] ?? record[snake];
  return value == null ? null : typeof value === 'string' ? value : null;
}

function normalizeChartRecord(raw: unknown): ChartRecord {
  const record = isRecord(raw) ? raw : {};
  const config = isRecord(record.config) ? record.config : {};

  const normalized: ChartRecord = {
    id: readString(record, 'id', 'id') || '',
    ownerId: readNullableString(record, 'ownerId', 'owner_id'),
    slug: readString(record, 'slug', 'slug') ?? '',
    name: readString(record, 'name', 'name') ?? '',
    isDefault: readBoolean(record, 'isDefault', 'is_default', false),
    isLocked: readBoolean(record, 'isLocked', 'is_locked', false),
    isEnabled: readBoolean(record, 'isEnabled', 'is_enabled', true),
    baselineRevision: typeof (record.baselineRevision ?? record.baseline_revision) === 'number'
      ? (record.baselineRevision ?? record.baseline_revision) as number
      : null,
    config: config as unknown as ChartDefinitionV1,
  };
  const description = readNullableString(record, 'description', 'description');
  if (description !== null) normalized.description = description;
  return normalized;
}

function normalizePermissions(raw: unknown): ChartManagerEntry['permissions'] {
  const record = isRecord(raw) ? raw : {};
  return {
    read: readBoolean(record, 'read', 'read', true),
    edit: readBoolean(record, 'edit', 'edit', false),
    duplicate: readBoolean(record, 'duplicate', 'duplicate', true),
    reset: readBoolean(record, 'reset', 'reset', false),
    restore: readBoolean(record, 'restore', 'restore', false),
    delete: readBoolean(record, 'delete', 'delete', false),
    lock: readBoolean(record, 'lock', 'lock', false),
  };
}

function normalizeManagerEntry(raw: unknown): ChartManagerEntry {
  const record = isRecord(raw) ? raw : {};
  const effective = normalizeChartRecord(record.effective ?? record);
  const systemBase = record.systemBase ?? record.system_base;
  const personalOverride = record.personalOverride ?? record.personal_override;
  const rawOrigin = record.origin;
  const origin = rawOrigin === 'override' || rawOrigin === 'personal' ? rawOrigin : 'system';

  const entry: ChartManagerEntry = {
    effective,
    origin,
    permissions: normalizePermissions(record.permissions),
  };
  if (systemBase) entry.systemBase = normalizeChartRecord(systemBase);
  if (personalOverride) entry.personalOverride = normalizeChartRecord(personalOverride);
  return entry;
}

function normalizeList<T>(raw: unknown, normalize: (value: unknown) => T): T[] {
  if (Array.isArray(raw)) return raw.map(normalize);
  if (isRecord(raw) && Array.isArray(raw.items)) return raw.items.map(normalize);
  if (isRecord(raw) && Array.isArray(raw.data)) return raw.data.map(normalize);
  return [];
}

function normalizeEffectiveRecord(raw: unknown): ChartRecord {
  if (isRecord(raw) && raw.effective) return normalizeChartRecord(raw.effective);
  return normalizeChartRecord(raw);
}

function chartPayload(input: ChartRecordInput) {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    config: input.config,
  };
}

function invalidateChartCatalogs(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['charts', 'manager'] });
  void queryClient.invalidateQueries({ queryKey: ['charts', 'effective'] });
  void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
}

export function useChartManager() {
  const authReady = useAuthReady();
  const userId = useAuth((state) => state.userId);

  return useQuery<ChartManagerEntry[]>({
    queryKey: ['charts', 'manager', userId],
    queryFn: async () => normalizeList(await api.apiFetch('GET', CHARTS_BASE), normalizeManagerEntry),
    enabled: authReady,
    staleTime: CHART_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

export function useEffectiveCharts(dashboardSlug: string | null) {
  const authReady = useAuthReady();
  const userId = useAuth((state) => state.userId);

  return useQuery<ChartRecord[]>({
    queryKey: ['charts', 'effective', dashboardSlug, userId],
    queryFn: async () => normalizeList(
      await api.apiFetch('GET', `${CHARTS_BASE}/effective?dashboard_slug=${encodeURIComponent(dashboardSlug ?? '')}`),
      normalizeEffectiveRecord,
    ),
    enabled: authReady && !!dashboardSlug,
    staleTime: CHART_QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

export function useChartSources() {
  const authReady = useAuthReady();
  return useQuery<ChartSourceManifest[]>({
    queryKey: ['chart-sources'],
    queryFn: async () => normalizeList(await api.apiFetch('GET', CHART_SOURCES_BASE), (value) => value as ChartSourceManifest),
    enabled: authReady,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChartRecordInput) => api.apiFetch('POST', CHARTS_BASE, chartPayload(input)),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useUpdateChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChartUpdateInput) => api.apiFetch('PUT', `${CHARTS_BASE}/${input.id}`, chartPayload(input)),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useCloneChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, slug, name }: { id: string; slug?: string; name?: string }) =>
      api.apiFetch('POST', `${CHARTS_BASE}/${id}/clone`, { slug, name }),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useDeleteChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiFetch('DELETE', `${CHARTS_BASE}/${id}`),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useResetChart(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (overrideId: string = id ?? '') => api.apiFetch('DELETE', `${CHARTS_BASE}/${overrideId}`),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useSetChartEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isEnabled }: ChartEnabledUpdate) =>
      api.apiFetch('PATCH', `${CHARTS_BASE}/${id}/enabled`, { isEnabled }),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useSetChartPlacements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, placements }: ChartPlacementUpdate) =>
      api.apiFetch('PATCH', `${CHARTS_BASE}/${id}/placements`, { placements }),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useAdminUpdateChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChartUpdateInput) => api.apiFetch('PATCH', `/v1/admin/charts/${input.id}`, chartPayload(input)),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useAdminSetChartLock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      api.apiFetch('PATCH', `/v1/admin/charts/${id}/lock`, { locked }),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}

export function useAdminRestoreChart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiFetch('POST', `/v1/admin/charts/${id}/restore`),
    onSuccess: () => invalidateChartCatalogs(queryClient),
  });
}
