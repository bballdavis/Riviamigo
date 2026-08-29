import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CHART_SOURCE_MANIFESTS,
  exportChartJson,
  importChartJson,
} from '@riviamigo/dashboards';
import {
  useChartManager as useChartManagerApi,
  useChartSources as useChartSourcesApi,
  useAdminSetChartLock,
  useAdminRestoreChart,
  useCloneChart as useCloneChartApi,
  useCreateChart as useCreateChartApi,
  useDeleteChart as useDeleteChartApi,
  useResetChart as useResetChartApi,
  useSetChartEnabled as useSetChartEnabledApi,
  useSetChartPlacements as useSetChartPlacementsApi,
} from '@riviamigo/hooks';
import type { ChartManagerEntry, ChartRecord } from '@riviamigo/types';
import { useDashboards } from '@riviamigo/dashboards';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ResponsiveDialog, Switch } from '@riviamigo/ui/primitives';
import { Download, Ellipsis, Pencil, Plus, Upload, Copy, Search, LockKeyhole, RotateCcw, Tag, X } from 'lucide-react';

type ChartFilter = 'all' | 'defaults' | 'mine' | 'customized' | 'disabled' | 'unassigned';

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function recordExport(record: ChartRecord) {
  return exportChartJson(record);
}

export function ChartManagerSection() {
  const navigate = useNavigate();
  const charts = useChartManagerApi();
  const sources = useChartSourcesApi();
  const dashboards = useDashboards();
  const createChart = useCreateChartApi();
  const cloneChart = useCloneChartApi();
  const deleteChart = useDeleteChartApi();
  const resetChart = useResetChartApi();
  const setEnabled = useSetChartEnabledApi();
  const setPlacements = useSetChartPlacementsApi();
  const adminSetLock = useAdminSetChartLock();
  const adminRestore = useAdminRestoreChart();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<ChartFilter>('all');
  const [openAssignments, setOpenAssignments] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<{ kind: 'delete' | 'restore'; entry: ChartManagerEntry } | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const sourceLabels = React.useMemo(
    () => new Map((sources.data ?? CHART_SOURCE_MANIFESTS).map((source) => [source.id, source.label])),
    [sources.data],
  );
  const dashboardLabels = React.useMemo(
    () => new Map((dashboards.data ?? []).map((dashboard) => [dashboard.slug, dashboard.name])),
    [dashboards.data],
  );
  const entries = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (charts.data ?? []).filter((entry) => {
      const chart = entry.effective;
      const assigned = chart.config.placements.length > 0;
      const matchesFilter = filter === 'all'
        || (filter === 'defaults' && entry.origin === 'system')
        || (filter === 'mine' && entry.origin === 'personal')
        || (filter === 'customized' && entry.origin === 'override')
        || (filter === 'disabled' && !chart.isEnabled)
        || (filter === 'unassigned' && !assigned);
      if (!matchesFilter) return false;
      if (!needle) return true;
      return `${chart.name} ${chart.slug} ${chart.description ?? ''}`.toLowerCase().includes(needle);
    });
  }, [charts.data, filter, query]);

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = await importChartJson(await file.text());
      const conflict = (charts.data ?? []).some((entry) => entry.effective.slug === imported.slug);
      const slug = conflict ? `${imported.slug}-copy` : imported.slug;
      await createChart.mutateAsync({ ...imported, slug });
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to import chart.');
    }
  }

  async function handleDuplicate(entry: ChartManagerEntry) {
    const nextSlug = `${entry.effective.slug}-copy`;
    try {
      await cloneChart.mutateAsync({ id: entry.effective.id, slug: nextSlug, name: `${entry.effective.name} Copy` });
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to duplicate chart.');
    }
  }

  async function saveEffectiveUpdate(entry: ChartManagerEntry, patch: { isEnabled?: boolean; placements?: Array<{ dashboardSlug: string }> }) {
    const config = patch.placements
      ? { ...entry.effective.config, placements: patch.placements }
      : entry.effective.config;
    if (entry.origin === 'system') {
      await createChart.mutateAsync({
        slug: entry.effective.slug,
        name: entry.effective.name,
        ...(entry.effective.description !== undefined ? { description: entry.effective.description } : {}),
        isEnabled: patch.isEnabled ?? entry.effective.isEnabled,
        config,
      });
      return;
    }
    if (patch.placements) {
      await setPlacements.mutateAsync({ id: entry.effective.id, placements: patch.placements });
    } else if (patch.isEnabled !== undefined) {
      await setEnabled.mutateAsync({ id: entry.effective.id, isEnabled: patch.isEnabled });
    }
  }

  async function handleDelete(entry: ChartManagerEntry) {
    const isReset = entry.origin === 'override' && !!entry.systemBase;
    if (isReset || entry.permissions.delete) setConfirmation({ kind: 'delete', entry });
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { entry } = confirmation;
    try {
      if (confirmation.kind === 'restore') await adminRestore.mutateAsync(entry.effective.id);
      else if (entry.origin === 'override' && entry.systemBase) await resetChart.mutateAsync(entry.effective.id);
      else await deleteChart.mutateAsync(entry.effective.id);
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to update chart.');
    } finally {
      setConfirmation(null);
    }
  }

  async function handleLock(entry: ChartManagerEntry) {
    try {
      await adminSetLock.mutateAsync({ id: entry.effective.id, locked: !entry.effective.isLocked });
      setMutationError(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to update chart lock state.');
    }
  }

  async function handleRestore(entry: ChartManagerEntry) {
    setConfirmation({ kind: 'restore', entry });
  }

  if (charts.isLoading) {
    return <Card><CardContent className="grid gap-3 p-5">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-bg-elevated" />)}</CardContent></Card>;
  }

  if (charts.isError) {
    return (
      <Card>
        <CardContent className="grid gap-3 p-5">
          <p className="text-sm text-fg-secondary">Chart management is unavailable from the connected API.</p>
          <p className="text-xs text-fg-tertiary">This usually means the server needs the chart-resource migration before this section can be used.</p>
          <Button variant="secondary" size="sm" onClick={() => { void charts.refetch(); }}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Charts</CardTitle>
              <p className="mt-1 text-sm text-fg-tertiary">Manage bundled chart defaults, personal copies, and dashboard placement.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input ref={importInputRef} type="file" accept=".json,.riviamigo-chart.json" className="sr-only" onChange={handleImport} />
              <Button variant="secondary" size="sm" iconLeft={<Upload className="h-4 w-4" />} aria-label="Import chart" onClick={() => importInputRef.current?.click()}>Import</Button>
              <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => navigate({ to: '/settings/charts/new' })}>Create chart</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search charts" aria-label="Search charts" className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-sm text-fg outline-none focus:border-accent" />
            </label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as ChartFilter)} aria-label="Filter charts" className="h-10 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent">
              <option value="all">All charts</option>
              <option value="defaults">App defaults</option>
              <option value="mine">My charts</option>
              <option value="customized">Customized</option>
              <option value="disabled">Disabled</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          {mutationError ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{mutationError}</p> : null}
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-fg-tertiary">No charts match this filter.</div>
          ) : (
            <div className="grid gap-2">
              {entries.map((entry) => (
                <ChartManagerRow
                  key={entry.effective.id}
                  entry={entry}
                  sourceLabels={sourceLabels}
                  dashboardLabels={dashboardLabels}
                  dashboards={dashboards.data ?? []}
                  assignmentOpen={openAssignments === entry.effective.id}
                  onAssignmentToggle={() => setOpenAssignments((current) => current === entry.effective.id ? null : entry.effective.id)}
                  onAssignmentsChange={async (placements) => {
                    try {
                      await saveEffectiveUpdate(entry, { placements });
                      setOpenAssignments(null);
                      setMutationError(null);
                    } catch (error) {
                      setMutationError(error instanceof Error ? error.message : 'Unable to update assignments.');
                    }
                  }}
                  onEdit={() => navigate({ to: '/settings/charts/$chartId', params: { chartId: entry.effective.id } })}
                  onDuplicate={() => { void handleDuplicate(entry); }}
                  onExport={() => downloadText(`${entry.effective.slug}.riviamigo-chart.json`, recordExport(entry.effective))}
                  onToggle={() => { void saveEffectiveUpdate(entry, { isEnabled: !entry.effective.isEnabled }).catch((error) => setMutationError(error instanceof Error ? error.message : 'Unable to update chart.')); }}
                  onDelete={() => { void handleDelete(entry); }}
                  {...(entry.permissions.lock ? { onLock: () => { void handleLock(entry); } } : {})}
                  {...(entry.permissions.restore ? { onRestore: () => { void handleRestore(entry); } } : {})}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {confirmation ? <ChartConfirmationDialog confirmation={confirmation} pending={adminRestore.isPending || deleteChart.isPending || resetChart.isPending} onCancel={() => setConfirmation(null)} onConfirm={() => { void confirmAction(); }} /> : null}
    </div>
  );
}

function ChartConfirmationDialog({
  confirmation,
  pending,
  onCancel,
  onConfirm,
}: {
  confirmation: { kind: 'delete' | 'restore'; entry: ChartManagerEntry };
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isRestore = confirmation.kind === 'restore';
  const isReset = !isRestore && confirmation.entry.origin === 'override' && !!confirmation.entry.systemBase;
  const title = isRestore
    ? `Restore ${confirmation.entry.effective.name}?`
    : isReset
      ? `Reset ${confirmation.entry.effective.name} to the app default?`
      : `Delete ${confirmation.entry.effective.name}?`;
  const description = isRestore
    ? 'This replaces the system chart with the bundled baseline.'
    : isReset
      ? 'Your personal override will be removed and the bundled chart will become effective again.'
      : 'This removes the personal chart and cannot be undone.';
  return <ResponsiveDialog titleId="chart-confirm-title" onClose={onCancel}><div className="flex min-h-0 flex-1 flex-col p-5"><div className="flex items-start justify-between gap-3"><div><h2 id="chart-confirm-title" className="text-base font-semibold text-fg">{title}</h2><p className="mt-2 text-sm text-fg-tertiary">{description}</p></div><IconButton label="Close confirmation" icon={<X className="h-4 w-4" />} onClick={onCancel} compact /></div><div className="mt-auto flex flex-col-reverse gap-2 pt-6 sm:mt-5 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" size="md" onClick={onCancel}>Cancel</Button><Button type="button" variant="danger" size="md" loading={pending} onClick={onConfirm}>{isRestore ? 'Restore bundled' : isReset ? 'Reset to app default' : 'Delete chart'}</Button></div></div></ResponsiveDialog>;
}

function ChartManagerRow({
  entry,
  sourceLabels,
  dashboardLabels,
  dashboards,
  assignmentOpen,
  onAssignmentToggle,
  onAssignmentsChange,
  onEdit,
  onDuplicate,
  onExport,
  onToggle,
  onDelete,
  onLock,
  onRestore,
}: {
  entry: ChartManagerEntry;
  sourceLabels: Map<string, string>;
  dashboardLabels: Map<string, string>;
  dashboards: Array<{ slug: string; name: string }>;
  assignmentOpen: boolean;
  onAssignmentToggle: () => void;
  onAssignmentsChange: (placements: Array<{ dashboardSlug: string }>) => Promise<void>;
  onEdit: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onLock?: () => void;
  onRestore?: () => void;
}) {
  const chart = entry.effective;
  const placements = chart.config.placements;

  return (
    <article className="relative grid gap-4 rounded-xl border border-border bg-bg-elevated/25 p-4 pb-14 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:pb-4">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-fg">{chart.name}</h3><OriginBadge entry={entry} />{statusBadgesForRow(entry)}</div>
        <p className="mt-1 truncate text-xs text-fg-tertiary">{chart.slug} · {chart.config.series.length} series · {chart.config.sources.map((source) => sourceLabels.get(source.sourceId) ?? source.sourceId).join(', ')}</p>
        {chart.description ? <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">{chart.description}</p> : null}
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-fg-secondary">Assigned dashboards</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {placements.map((placement) => <DashboardBadge key={placement.dashboardSlug} slug={placement.dashboardSlug} name={dashboardLabels.get(placement.dashboardSlug) ?? placement.dashboardSlug} />)}
            {placements.length === 0 ? <span className="text-xs text-fg-tertiary">None assigned</span> : null}
            <button type="button" aria-label={`Edit dashboard assignments for ${chart.name}`} title="Edit dashboard assignments" className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[10px] font-medium text-fg-secondary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onAssignmentToggle}><Pencil className="h-3 w-3" /><span className="sr-only">Edit dashboards</span></button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <IconButton label={`Edit ${chart.name}`} icon={<Pencil className="h-4 w-4" />} onClick={onEdit} />
        <IconButton label={`Duplicate ${chart.name}`} icon={<Copy className="h-4 w-4" />} onClick={onDuplicate} />
        <IconButton label={`Export ${chart.name}`} icon={<Download className="h-4 w-4" />} onClick={onExport} />
        {onLock ? <IconButton label={`${chart.isLocked ? 'Unlock' : 'Lock'} ${chart.name}`} icon={<LockKeyhole className="h-4 w-4" />} onClick={onLock} /> : null}
        {onRestore ? <IconButton label={`Restore bundled ${chart.name}`} icon={<RotateCcw className="h-4 w-4" />} onClick={onRestore} /> : null}
        <div className="relative group">
          <IconButton label={`More actions for ${chart.name}`} icon={<Ellipsis className="h-4 w-4" />} onClick={onDelete} />
          <span className="pointer-events-none absolute right-0 top-12 z-10 hidden w-44 rounded-lg border border-border bg-bg-surface p-2 text-xs text-fg-secondary shadow-xl group-focus-within:block">{entry.origin === 'override' ? 'Reset to app default' : 'Delete personal chart'}</span>
        </div>
      </div>
      <div className="absolute bottom-3 right-4 flex items-center gap-2 text-xs font-medium text-fg-secondary"><span>{chart.isEnabled ? 'Enabled' : 'Disabled'}</span><Switch checked={chart.isEnabled} onChange={onToggle} aria-label={`${chart.isEnabled ? 'Disable' : 'Enable'} ${chart.name}`} /></div>
      {assignmentOpen ? <DashboardAssignmentsDialog chartName={chart.name} dashboards={dashboards} placements={placements} onClose={onAssignmentToggle} onSave={onAssignmentsChange} /> : null}
    </article>
  );
}

function OriginBadge({ entry }: { entry: ChartManagerEntry }) {
  return <Badge variant={entry.origin === 'system' ? 'info' : 'default'} size="sm">{entry.origin === 'system' ? 'App default' : entry.origin === 'override' ? 'Customized' : 'My chart'}</Badge>;
}

function statusBadgesForRow(entry: ChartManagerEntry) {
  const chart = entry.effective;
  return <span className="flex flex-wrap items-center gap-1.5">{chart.isLocked ? <Badge variant="warning" size="sm">Locked</Badge> : null}{chart.config.placements.length === 0 ? <Badge variant="default" size="sm">Unassigned</Badge> : null}</span>;
}

const DASHBOARD_VARIANTS: Array<NonNullable<React.ComponentProps<typeof Badge>['variant']>> = ['accent', 'info', 'success', 'warning', 'danger'];

function dashboardVariant(slug: string) {
  const hash = [...slug].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
  return DASHBOARD_VARIANTS[hash % DASHBOARD_VARIANTS.length] ?? 'default';
}

function DashboardBadge({ slug, name }: { slug: string; name: string }) {
  return <Badge variant={dashboardVariant(slug)} size="md" className="max-w-40"><Tag className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{name}</span></Badge>;
}

function IconButton({ label, icon, onClick, compact = false }: { label: string; icon: React.ReactNode; onClick: () => void; compact?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`${compact ? 'h-9 w-9' : 'h-11 w-11'} inline-flex items-center justify-center rounded-lg border border-border text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>{icon}</button>;
}

function DashboardAssignmentsDialog({ chartName, dashboards, placements, onClose, onSave }: { chartName: string; dashboards: Array<{ slug: string; name: string }>; placements: Array<{ dashboardSlug: string }>; onClose: () => void; onSave: (placements: Array<{ dashboardSlug: string }>) => Promise<void> }) {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(() => new Set(placements.map((placement) => placement.dashboardSlug)));
  const [saving, setSaving] = React.useState(false);
  const normalized = query.trim().toLowerCase();
  const visible = dashboards.filter((dashboard) => !normalized || `${dashboard.name} ${dashboard.slug}`.toLowerCase().includes(normalized));
  return <ResponsiveDialog titleId="chart-assignments-title" onClose={onClose}><header className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:p-5"><div><h2 id="chart-assignments-title" className="text-base font-semibold text-fg">Assigned dashboards</h2><p className="mt-1 text-sm text-fg-tertiary">Choose where {chartName} is available.</p></div><IconButton label="Close dashboard assignments" icon={<X className="h-4 w-4" />} onClick={onClose} compact /></header><div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-5"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search dashboards" aria-label="Search dashboards" className="h-10 w-full rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-sm text-fg outline-none focus:border-accent" /></label><div className="mt-3 grid gap-1">{visible.map((dashboard) => { const checked = selected.has(dashboard.slug); return <button key={dashboard.slug} type="button" role="checkbox" aria-checked={checked} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(dashboard.slug)) next.delete(dashboard.slug); else next.add(dashboard.slug); return next; })} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${checked ? 'bg-accent/10 text-fg' : 'text-fg-secondary hover:bg-bg-elevated'}`}><DashboardBadge slug={dashboard.slug} name={dashboard.name} /><span className="ml-auto text-xs text-fg-tertiary">{checked ? 'Assigned' : 'Not assigned'}</span></button>; })}{visible.length === 0 ? <p className="px-3 py-6 text-center text-sm text-fg-tertiary">No dashboards found.</p> : null}</div></div><footer className="flex flex-col-reverse gap-2 border-t border-border bg-bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:p-5"><Button type="button" variant="secondary" size="md" onClick={onClose}>Cancel</Button><Button type="button" variant="primary" size="md" loading={saving} onClick={() => { setSaving(true); void onSave([...selected].sort().map((dashboardSlug) => ({ dashboardSlug }))).finally(() => setSaving(false)); }}>Save assignments</Button></footer></ResponsiveDialog>;
}
