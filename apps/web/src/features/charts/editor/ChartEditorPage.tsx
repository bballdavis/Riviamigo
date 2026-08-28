import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CHART_SOURCE_MANIFESTS,
  ChartDefinitionRenderer,
  ChartDefinitionV1Schema,
  downloadChartYaml,
  getBundledChartDefinition,
  resolveChartSourceCapabilities,
  validateChartDefinitionAgainstSources,
} from '@riviamigo/dashboards';
import {
  useChartManager,
  useChartSources,
  useChartDatasets,
  useMetricCatalog,
  useResolvedVehicleSelection,
  useCreateChart,
  useUpdateChart,
} from '@riviamigo/hooks';
import type { ChartAxisDefinition, ChartColorToken, ChartDefinitionV1, ChartMark, ChartRecord, ChartSeriesDefinition, ChartSourceManifest, MetricCatalogEntry } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker, Switch } from '@riviamigo/ui/primitives';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Download, Plus, Save, Search, Trash2 } from 'lucide-react';

type EditorSection = 'basics' | 'sources' | 'domain' | 'series' | 'display' | 'advanced';

const TOKEN_COLORS: Array<{ token: ChartColorToken; label: string }> = [
  { token: 'accent', label: 'Accent' },
  { token: 'emerald', label: 'Emerald' },
  { token: 'sky', label: 'Sky' },
  { token: 'violet', label: 'Violet' },
  { token: 'amber', label: 'Amber' },
];

const MARKS: ChartMark[] = ['line', 'area', 'step', 'bar', 'scatter', 'histogram'];

function copyDefinition(definition: ChartDefinitionV1): ChartDefinitionV1 {
  return structuredClone(definition);
}

function defaultDefinition(): ChartDefinitionV1 {
  const bundled = getBundledChartDefinition('soc-history');
  if (!bundled) throw new Error('Bundled chart defaults are unavailable');
  const { slug, title, description, ...definition } = bundled;
  void slug;
  void title;
  void description;
  return copyDefinition(ChartDefinitionV1Schema.parse(definition) as ChartDefinitionV1);
}

function configRecord(record: ChartRecord): ChartRecord {
  return { ...record, config: copyDefinition(record.config) };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to save chart.';
}

export function ChartEditorPage({ mode, chartId }: { mode: 'new' | 'edit'; chartId?: string }) {
  const navigate = useNavigate();
  const manager = useChartManager();
  const sources = useChartSources();
  const metricCatalog = useMetricCatalog();
  const createChart = useCreateChart();
  const updateChart = useUpdateChart();
  const [section, setSection] = React.useState<EditorSection>('basics');
  const [draft, setDraft] = React.useState<ChartRecord | null>(() => mode === 'new' ? {
    id: '',
    ownerId: null,
    slug: 'new-chart',
    name: 'New chart',
    isDefault: false,
    isLocked: false,
    isEnabled: true,
    config: defaultDefinition(),
  } : null);
  const [advancedText, setAdvancedText] = React.useState('');
  const [dirty, setDirty] = React.useState(mode === 'new');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [discardRequested, setDiscardRequested] = React.useState(false);
  const discardDialogRef = React.useRef<HTMLDivElement | null>(null);
  const [sourceNotice, setSourceNotice] = React.useState<string | null>(null);
  const entry = manager.data?.find((candidate) => candidate.effective.id === chartId);
  const manifests = React.useMemo(() => resolveChartSourceCapabilities(
    sources.data && sources.data.some((source) => source.fields.length > 0) ? sources.data : [...CHART_SOURCE_MANIFESTS],
    metricCatalog.data ?? [],
  ), [metricCatalog.data, sources.data]);
  const { effectiveVehicleId } = useResolvedVehicleSelection();
  const previewData = useChartDatasets(draft?.config ?? null, {
    vehicleId: effectiveVehicleId,
    from: null,
    to: null,
    lifetime: draft?.config.timeframe.mode === 'lifetime',
  });

  React.useEffect(() => {
    if (mode !== 'edit' || !entry || dirty) return;
    const next = configRecord(entry.effective);
    setDraft(next);
    setAdvancedText(JSON.stringify(next.config, null, 2));
  }, [dirty, entry, mode]);

  React.useEffect(() => {
    if (!draft || advancedText) return;
    setAdvancedText(JSON.stringify(draft.config, null, 2));
  }, [advancedText, draft]);

  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  React.useEffect(() => {
    if (!discardRequested) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const dialog = discardDialogRef.current;
    dialog?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiscardRequested(false);
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [discardRequested]);

  const validationErrors = React.useMemo(() => {
    if (!draft) return [{ path: 'chart', message: 'Chart draft is not available.' }];
    try {
      const parsed = ChartDefinitionV1Schema.safeParse(draft.config);
      if (!parsed.success) return parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return validateChartDefinitionAgainstSources(draft.config, manifests);
    } catch (error) {
      return [{ path: 'config', message: errorText(error) }];
    }
  }, [draft, manifests]);

  function updateDraft(patch: Partial<ChartRecord>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setDirty(true);
    setSaveError(null);
  }

  function updateDefinition(mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) {
    setDraft((current) => current ? { ...current, config: mutator(current.config) } : current);
    setDirty(true);
    setSaveError(null);
  }

  function goBack() {
    if (dirty) {
      setDiscardRequested(true);
      return;
    }
    navigate({ to: '/settings', search: { section: 'charts' } });
  }

  function discardAndGoBack() {
    setDiscardRequested(false);
    setDirty(false);
    navigate({ to: '/settings', search: { section: 'charts' } });
  }

  async function save() {
    if (!draft) return;
    if (validationErrors.length > 0) {
      setSaveError(`Fix ${validationErrors.length} validation error${validationErrors.length === 1 ? '' : 's'} before saving.`);
      setSection(validationErrors[0]?.path.startsWith('config.sources') ? 'sources' : validationErrors[0]?.path.startsWith('config.series') ? 'series' : validationErrors[0]?.path.startsWith('config.axes') ? 'display' : 'basics');
      return;
    }
    try {
      if (mode === 'new' || entry?.origin === 'system') {
        await createChart.mutateAsync({
          slug: draft.slug,
          name: draft.name,
          ...(draft.description !== undefined ? { description: draft.description } : {}),
          isEnabled: draft.isEnabled,
          config: draft.config,
        });
      } else {
        await updateChart.mutateAsync({
          id: draft.id,
          slug: draft.slug,
          name: draft.name,
          ...(draft.description !== undefined ? { description: draft.description } : {}),
          isEnabled: draft.isEnabled,
          config: draft.config,
        });
      }
      setDirty(false);
      setSaveError(null);
      navigate({ to: '/settings', search: { section: 'charts' } });
    } catch (error) {
      setSaveError(errorText(error));
    }
  }

  if (!draft) {
    return <div className="grid min-h-screen place-items-center bg-bg-page p-5 text-sm text-fg-secondary">Loading chart editor…</div>;
  }

  return (
    <div className="min-h-screen bg-bg-page text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg-page/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3">
          <button type="button" aria-label="Back to charts" title="Back to charts" onClick={goBack} className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-base font-semibold">{draft.name}</h1><Badge variant={entry?.origin === 'system' ? 'info' : 'default'} size="sm">{entry?.origin === 'system' ? 'Customize app default' : mode === 'new' ? 'New chart' : 'My chart'}</Badge>{dirty ? <span className="text-xs text-fg-tertiary">Unsaved changes</span> : null}</div>
            <p className="truncate text-xs text-fg-tertiary">{draft.slug}</p>
          </div>
          <Button variant="secondary" size="sm" iconLeft={<Download className="h-4 w-4" />} onClick={() => { if (draft.id) downloadChartYaml(draft); else setSaveError('Save the chart before exporting it.'); }}>Export</Button>
          <Button variant="primary" size="sm" iconLeft={<Save className="h-4 w-4" />} loading={createChart.isPending || updateChart.isPending} onClick={() => { void save(); }}>Save</Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:items-start">
        <PreviewPanel draft={draft} errors={validationErrors} datasets={previewData.datasets} loading={previewData.isLoading} sourceErrors={previewData.errors} />
        <section className="min-w-0 lg:col-start-2 lg:row-start-1">
          <nav aria-label="Chart editor sections" className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg-surface p-1">
            {(['basics', 'sources', 'domain', 'series', 'display', 'advanced'] as EditorSection[]).map((item) => <button key={item} type="button" onClick={() => setSection(item)} className={`min-h-10 shrink-0 rounded-lg px-3 text-left text-sm capitalize transition-colors ${section === item ? 'bg-bg-elevated font-medium text-fg' : 'text-fg-secondary hover:bg-bg-elevated/70'}`}>{item}</button>)}
          </nav>
          {saveError ? <div role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{saveError}</div> : null}
          {sourceNotice ? <div role="status" className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-fg-secondary">{sourceNotice}</div> : null}
          {section === 'basics' && <BasicsSection draft={draft} onChange={updateDraft} />}
          {section === 'sources' && <SourcesSection definition={draft.config} manifests={manifests} metrics={metricCatalog.data ?? []} onNotice={setSourceNotice} onChange={updateDefinition} />}
          {section === 'domain' && <DomainSection definition={draft.config} manifests={manifests} onChange={updateDefinition} />}
          {section === 'series' && <SeriesSection definition={draft.config} manifests={manifests} metrics={metricCatalog.data ?? []} onNotice={setSourceNotice} onChange={updateDefinition} />}
          {section === 'display' && <DisplaySection definition={draft.config} onChange={updateDefinition} />}
          {section === 'advanced' && <AdvancedSection value={advancedText} onChange={(value) => { setAdvancedText(value); try { updateDefinition(() => ChartDefinitionV1Schema.parse(JSON.parse(value)) as ChartDefinitionV1); } catch { setDirty(true); } }} />}
        </section>
      </main>
      {discardRequested ? <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-bg-page/85 sm:items-center sm:p-4"><div ref={discardDialogRef} role="dialog" aria-modal="true" aria-labelledby="discard-chart-title" className="flex min-h-[100dvh] w-full flex-col bg-bg-surface p-[max(1.25rem,env(safe-area-inset-top))] shadow-lg sm:min-h-0 sm:max-w-md sm:rounded-xl sm:border sm:border-border sm:p-5"><h2 id="discard-chart-title" className="text-base font-semibold">Discard unsaved changes?</h2><p className="mt-2 text-sm text-fg-tertiary">Your chart draft will not be saved.</p><div className="mt-auto flex flex-col-reverse gap-2 pt-6 sm:mt-5 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" size="md" onClick={() => setDiscardRequested(false)}>Keep editing</Button><Button type="button" variant="danger" size="md" onClick={discardAndGoBack}>Discard changes</Button></div></div></div> : null}
    </div>
  );
}

function BasicsSection({ draft, onChange }: { draft: ChartRecord; onChange: (patch: Partial<ChartRecord>) => void }) {
  return <EditorCard title="Basics" description="Stable slugs keep favorites and dashboard settings attached to the same chart."><div className="grid gap-4"><EditorField label="Name"><input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} className="editor-input" /></EditorField><EditorField label="Slug" hint="Locked after first save in the production editor."><input value={draft.slug} disabled={!!draft.id} onChange={(event) => onChange({ slug: event.target.value })} className="editor-input disabled:opacity-60" /></EditorField><EditorField label="Description"><textarea value={draft.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} rows={3} className="editor-input py-2" /></EditorField><ToggleRow label="Enabled" description="Disabled charts remain saved but are hidden from assigned dashboards." checked={draft.isEnabled} onCheckedChange={(checked) => onChange({ isEnabled: checked })} /></div></EditorCard>;
}

function SourcesSection({ definition, manifests, metrics, onNotice, onChange }: { definition: ChartDefinitionV1; manifests: ChartSourceManifest[]; metrics: MetricCatalogEntry[]; onNotice: (notice: string | null) => void; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const source = definition.sources[0];
  const activeManifest = manifests.find((manifest) => manifest.id === source?.sourceId);
  return <EditorCard title="Data sources" description="Only allowlisted Riviamigo sources can be used by a saved chart."><div className="grid gap-4"><EditorField label="Primary source"><SelectPicker value={source?.sourceId ?? ''} options={manifests.map((manifest) => ({ value: manifest.id, label: manifest.label, description: manifest.category }))} onChange={(sourceId) => { const manifest = manifests.find((candidate) => candidate.id === sourceId); if (!manifest) return; onChange((current) => replacePrimarySource(current, manifest, metrics)); onNotice(`Source changed to ${manifest.label}. Incompatible domain and series bindings were updated.`); }} aria-label="Primary chart source" className="w-full" /></EditorField><div className="rounded-lg border border-border bg-bg-elevated/30 p-3 text-sm text-fg-secondary">{activeManifest?.description ?? 'Source capability metadata is loading.'}<p className="mt-2 text-xs text-fg-tertiary">{definition.sources.length} of 4 source bindings used.</p></div><ToggleRow label="Inherit active vehicle" checked={source?.inherit.vehicle ?? true} onCheckedChange={(checked) => onChange((current) => ({ ...current, sources: current.sources.map((binding, index) => index === 0 ? { ...binding, inherit: { ...binding.inherit, vehicle: checked } } : binding) }))} /><ToggleRow label="Inherit dashboard timeframe" checked={source?.inherit.timeframe ?? true} onCheckedChange={(checked) => onChange((current) => ({ ...current, sources: current.sources.map((binding, index) => index === 0 ? { ...binding, inherit: { ...binding.inherit, timeframe: checked } } : binding) }))} /></div></EditorCard>;
}

function DomainSection({ definition, manifests, onChange }: { definition: ChartDefinitionV1; manifests: ChartSourceManifest[]; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const binding = definition.sources.find((source) => source.id === definition.x.field.sourceBindingId) ?? definition.sources[0];
  const manifest = manifests.find((candidate) => candidate.id === binding?.sourceId);
  const fields = manifest?.fields.filter((field) => field.roles.includes('x')) ?? [];
  const selected = fields.find((field) => field.id === definition.x.field.field);
  return <EditorCard title="X axis and domain" description="Choose from the fields exposed by the selected trusted source."><div className="grid gap-4"><EditorField label="X field"><SearchPicker value={definition.x.field.field} options={fields.map((field) => ({ value: field.id, label: field.label, description: [field.kind, field.unit].filter(Boolean).join(' · ') }))} onChange={(fieldId) => { const field = fields.find((candidate) => candidate.id === fieldId); if (!field || !binding) return; onChange((current) => ({ ...current, x: { ...current.x, field: { sourceBindingId: binding.id, field: field.id }, kind: field.kind, ...(field.unit ? { unit: field.unit } : {}) } })); }} ariaLabel="X axis field" /></EditorField><div className="grid gap-3 sm:grid-cols-2"><ReadOnlyFact label="Domain kind" value={selected?.kind ?? definition.x.kind} /><ReadOnlyFact label="Unit" value={selected?.unit ?? 'None'} /></div><EditorField label="Timeframe policy"><select value={definition.timeframe.mode === 'relative' ? definition.timeframe.preset : definition.timeframe.mode} onChange={(event) => onChange((current) => ({ ...current, timeframe: event.target.value === 'dashboard' ? { mode: 'dashboard' } : event.target.value === 'lifetime' ? { mode: 'lifetime' } : { mode: 'relative', preset: event.target.value as '24h' | '7d' | '30d' | '90d' | '1y' } }))} className="editor-input"><option value="dashboard">Dashboard</option><option value="24h">Relative 24 hours</option><option value="7d">Relative 7 days</option><option value="30d">Relative 30 days</option><option value="90d">Relative 90 days</option><option value="1y">Relative 1 year</option><option value="lifetime">Lifetime</option></select></EditorField><p className="text-xs text-fg-tertiary">Binding: {binding?.id ?? 'none'} · Source: {manifest?.label ?? 'Unavailable'}</p></div></EditorCard>;
}

function SeriesSection({ definition, manifests, metrics, onNotice, onChange }: { definition: ChartDefinitionV1; manifests: ChartSourceManifest[]; metrics: MetricCatalogEntry[]; onNotice: (notice: string | null) => void; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const choices = buildSeriesChoices(definition, manifests, metrics);
  return <EditorCard title="Series" description="Search every queryable metric or choose a field from a specialized source."><div className="grid gap-3">{definition.series.map((series, index) => <div key={series.id} className="grid gap-3 rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">Series {index + 1}</strong><div className="flex gap-1"><button type="button" aria-label="Move series up" disabled={index === 0} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index - 1) }))} className="icon-button"><ChevronUp className="h-4 w-4" /></button><button type="button" aria-label="Move series down" disabled={index === definition.series.length - 1} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index + 1) }))} className="icon-button"><ChevronDown className="h-4 w-4" /></button><button type="button" aria-label="Remove series" disabled={definition.series.length === 1} onClick={() => onChange((current) => ({ ...current, series: current.series.filter((_, seriesIndex) => seriesIndex !== index) }))} className="icon-button text-danger"><Trash2 className="h-4 w-4" /></button></div></div><div className="grid gap-3"><EditorField label="Sensor or value"><SearchPicker value={choiceValueForSeries(series, definition)} options={choices} onChange={(choice) => onChange((current) => applySeriesChoice(current, index, choice, manifests, metrics, onNotice))} ariaLabel={`Series ${index + 1} sensor or value`} /></EditorField><EditorField label="Label"><input value={series.label} onChange={(event) => patchSeries(onChange, index, { label: event.target.value })} className="editor-input" /></EditorField><div className="grid gap-3 sm:grid-cols-2"><EditorField label="Mark"><select value={series.mark} onChange={(event) => patchSeries(onChange, index, { mark: event.target.value as ChartMark })} className="editor-input">{MARKS.map((mark) => <option key={mark} value={mark}>{mark}</option>)}</select></EditorField><EditorField label="Y axis"><select value={series.yAxis} onChange={(event) => patchSeries(onChange, index, { yAxis: event.target.value as 'y' | 'y2' })} className="editor-input"><option value="y">Left axis</option><option value="y2">Right axis</option></select></EditorField><EditorField label="Color"><select value={series.color.mode === 'token' ? series.color.token : 'accent'} onChange={(event) => patchSeries(onChange, index, { color: { mode: 'token', token: event.target.value as ChartColorToken } })} className="editor-input">{TOKEN_COLORS.map((color) => <option key={color.token} value={color.token}>{color.label}</option>)}</select></EditorField></div></div></div>)}<Button variant="secondary" size="sm" iconLeft={<Plus className="h-4 w-4" />} disabled={choices.length === 0} onClick={() => onChange((current) => addSeriesFromChoice(current, choices[0]?.value, manifests, metrics, onNotice))}>Add series</Button><p className="text-xs text-fg-tertiary">Metric series create reusable trusted bindings. A chart can use up to four source bindings.</p></div></EditorCard>;
}

function DisplaySection({ definition, onChange }: { definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  return <EditorCard title="Display and interaction" description="Preview the exact labels, marks, and interaction settings that will be saved."><div className="grid gap-5"><div className="grid gap-4"><h3 className="text-sm font-semibold text-fg">Axis labels</h3><EditorField label="X axis label"><input value={definition.axes.x.label ?? ''} onChange={(event) => patchAxis(onChange, 'x', { label: event.target.value })} className="editor-input" /></EditorField><EditorField label="Y axis label"><input value={definition.axes.y.label ?? ''} onChange={(event) => patchAxis(onChange, 'y', { label: event.target.value })} className="editor-input" /></EditorField><ToggleRow label="Right Y axis" description="Adds a separately labeled scale for series assigned to the right axis." checked={!!definition.axes.y2} onCheckedChange={(checked) => onChange((current) => ({ ...current, axes: checked ? { ...current.axes, y2: current.axes.y2 ?? { scale: 'linear', domain: { mode: 'auto' } } } : { x: current.axes.x, y: current.axes.y }, series: checked ? current.series : current.series.map((series) => ({ ...series, yAxis: 'y' as const })) }))} />{definition.axes.y2 ? <EditorField label="Right Y axis label"><input value={definition.axes.y2.label ?? ''} onChange={(event) => patchAxis(onChange, 'y2', { label: event.target.value })} className="editor-input" /></EditorField> : null}</div><div className="border-t border-border pt-5"><h3 className="mb-4 text-sm font-semibold text-fg">Ranges</h3><div className="grid gap-3">{(['x', 'y', ...(definition.axes.y2 ? ['y2'] : [])] as Array<'x' | 'y' | 'y2'>).map((axis) => <AxisRangeEditor key={axis} axis={axis} definition={definition} onChange={onChange} />)}</div></div><div className="grid gap-4 border-t border-border pt-5"><div className="grid gap-3 sm:grid-cols-2"><EditorField label="Legend"><select value={definition.display.legend} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, legend: event.target.value as ChartDefinitionV1['display']['legend'] } }))} className="editor-input"><option value="auto">Auto</option><option value="show">Show</option><option value="hide">Hide</option></select></EditorField><EditorField label="Curve smoothness"><select value={definition.display.curveSmoothness} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, curveSmoothness: event.target.value as ChartDefinitionV1['display']['curveSmoothness'] } }))} className="editor-input"><option value="straight">Straight</option><option value="gentle">Gentle</option><option value="smooth">Smooth</option></select></EditorField></div><ToggleRow label="Show grid" checked={definition.display.grid} onCheckedChange={(checked) => onChange((current) => ({ ...current, display: { ...current.display, grid: checked } }))} /><ToggleRow label="Enable tooltip" checked={definition.display.tooltip} onCheckedChange={(checked) => onChange((current) => ({ ...current, display: { ...current.display, tooltip: checked } }))} /></div></div></EditorCard>;
}

function AdvancedSection({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <EditorCard title="Advanced definition" description="JSON is validated by the same schema used for visual controls. Unsupported executable content is rejected."><textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} rows={24} className="min-h-[30rem] w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-xs text-fg outline-none focus:border-accent" /></EditorCard>;
}

function PreviewPanel({ draft, errors, datasets, loading, sourceErrors }: { draft: ChartRecord; errors: Array<{ path: string; message: string }>; datasets: import('@riviamigo/types').ChartDataset[]; loading: boolean; sourceErrors: unknown[] }) {
  const totalIssues = errors.length + sourceErrors.length;
  return <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start"><Card><CardHeader><CardTitle>Live preview</CardTitle><Badge variant={totalIssues ? 'warning' : 'success'} size="sm">{totalIssues ? `${totalIssues} issue${totalIssues === 1 ? '' : 's'}` : 'Valid'}</Badge></CardHeader><CardContent><div className="min-h-56 rounded-xl border border-border bg-bg-elevated/30 p-2"><ChartDefinitionRenderer definition={draft.config} datasets={datasets} height={260} loading={loading} /></div><p className="mt-3 text-xs text-fg-tertiary">Preview requests use the active vehicle and are kept separate from the saved definition.</p></CardContent></Card><Card><CardHeader><CardTitle>Diagnostics</CardTitle></CardHeader><CardContent className="grid gap-2 text-xs">{errors.map((error) => <div key={`${error.path}-${error.message}`} className="rounded-lg border border-danger/30 bg-danger/10 p-2"><strong className="text-danger">{error.path}</strong><p className="mt-1 text-fg-secondary">{error.message}</p></div>)}{sourceErrors.map((error, index) => <div key={index} className="rounded-lg border border-danger/30 bg-danger/10 p-2"><strong className="text-danger">Source request</strong><p className="mt-1 text-fg-secondary">{error instanceof Error ? error.message : 'Source request failed.'}</p></div>)}{totalIssues === 0 ? <><div className="flex items-center gap-2 text-success"><Check className="h-4 w-4" /> {datasets.length} normalized dataset{datasets.length === 1 ? '' : 's'}</div><div className="flex items-center gap-2 text-success"><Check className="h-4 w-4" /> {draft.config.series.length} rendered series</div><p className="text-fg-tertiary">Source point counts and stale/partial state are available in the normalized dataset metadata.</p></> : null}</CardContent></Card></aside>;
}

function EditorCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><div><CardTitle>{title}</CardTitle><p className="mt-1 text-sm text-fg-tertiary">{description}</p></div></CardHeader><CardContent>{children}</CardContent></Card>; }
function EditorField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</span>{children}{hint ? <span className="text-xs text-fg-tertiary">{hint}</span> : null}</label>; }
function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) { return <div className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2"><div><p className="text-sm font-medium text-fg">{label}</p>{description ? <p className="mt-0.5 text-xs text-fg-tertiary">{description}</p> : null}</div><Switch checked={checked} onChange={onCheckedChange} aria-label={label} /></div>; }
function ReadOnlyFact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-border bg-bg-elevated/30 px-3 py-2"><span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">{label}</span><p className="mt-1 text-sm text-fg">{value}</p></div>; }

type SearchOption = { value: string; label: string; description?: string };
function SearchPicker({ value, options, onChange, ariaLabel }: { value: string; options: SearchOption[]; onChange: (value: string) => void; ariaLabel: string }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative"><button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="editor-input flex min-h-10 items-center justify-between gap-2 text-left"><span className="min-w-0"><span className="block truncate text-sm text-fg">{selected?.label ?? 'Choose a field'}</span>{selected?.description ? <span className="block truncate text-xs text-fg-tertiary">{selected.description}</span> : null}</span><Search className="h-4 w-4 shrink-0 text-fg-tertiary" /></button>{open ? <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-bg-surface shadow-lg"><div className="border-b border-border p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search…" aria-label={`Search ${ariaLabel}`} className="editor-input" /></div><div role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto p-1">{filtered.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setQuery(''); setOpen(false); }} className={`block w-full rounded-md px-3 py-2 text-left ${option.value === value ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-bg-elevated'}`}><span className="block text-sm font-medium">{option.label}</span>{option.description ? <span className="block text-xs text-fg-tertiary">{option.description}</span> : null}</button>)}{filtered.length === 0 ? <p className="px-3 py-5 text-center text-sm text-fg-tertiary">No matching fields</p> : null}</div></div> : null}</div>;
}

function compatibleFields(manifest: ChartSourceManifest, role: 'x' | 'y') { return manifest.fields.filter((field) => field.roles.includes(role)); }
function replacePrimarySource(definition: ChartDefinitionV1, manifest: ChartSourceManifest, metrics: MetricCatalogEntry[]): ChartDefinitionV1 {
  const current = definition.sources[0];
  const xFields = compatibleFields(manifest, 'x');
  const yFields = compatibleFields(manifest, 'y');
  const x = xFields.find((field) => definition.x.field.sourceBindingId === current?.id && field.id === definition.x.field.field) ?? xFields[0];
  const currentPrimarySeries = definition.series.find((series) => series.y.sourceBindingId === current?.id);
  const y = yFields.find((field) => field.id === currentPrimarySeries?.y.field) ?? yFields[0];
  if (!current || !x || !y) return definition;
  const metric = manifest.id === 'metrics.series' ? metrics.find((candidate) => candidate.id === y.id && candidate.supports_series) : undefined;
  const baseInheritance = { vehicle: current.inherit.vehicle, timeframe: current.inherit.timeframe };
  const source = { ...current, sourceId: manifest.id, params: metric ? { metric: metric.id } : {}, filters: [], inherit: { ...baseInheritance, ...(manifest.supportsTripTagInheritance && current.inherit.tripTags !== undefined ? { tripTags: current.inherit.tripTags } : {}) } };
  return {
    ...definition,
    sources: [source, ...definition.sources.slice(1)],
    x: definition.x.field.sourceBindingId === current.id ? { ...definition.x, field: { sourceBindingId: source.id, field: x.id }, kind: x.kind, ...(x.unit ? { unit: x.unit } : {}) } : definition.x,
    series: definition.series.map((series) => {
      if (series.y.sourceBindingId !== current.id) return series;
      const compatible = manifest.id === 'metrics.series' ? y : yFields.find((field) => field.id === series.y.field) ?? y;
      const next = { ...series };
      if (next.x?.sourceBindingId === current.id) delete next.x;
      return { ...next, label: compatible.label, y: { sourceBindingId: source.id, field: compatible.id } };
    }),
  };
}

function metricDescription(metric: MetricCatalogEntry) { return [metric.source, metric.unit ?? 'unitless'].join(' · '); }
function buildSeriesChoices(definition: ChartDefinitionV1, manifests: ChartSourceManifest[], metrics: MetricCatalogEntry[]): SearchOption[] {
  const specialized = definition.sources.flatMap((binding) => {
    if (binding.sourceId === 'metrics.series') return [];
    const manifest = manifests.find((candidate) => candidate.id === binding.sourceId);
    return (manifest ? compatibleFields(manifest, 'y') : []).map((field) => ({ value: `field:${binding.id}:${field.id}`, label: field.label, description: `${manifest?.category ?? 'source'} · ${field.unit ?? 'unitless'}` }));
  });
  const metricChoices = metrics.filter((metric) => metric.supports_series).map((metric) => ({ value: `metric:${metric.id}`, label: metric.label, description: metricDescription(metric) }));
  return [...metricChoices, ...specialized];
}
function choiceValueForSeries(series: ChartSeriesDefinition, definition: ChartDefinitionV1) {
  const binding = definition.sources.find((source) => source.id === series.y.sourceBindingId);
  return binding?.sourceId === 'metrics.series' ? `metric:${String(binding.params.metric ?? series.y.field)}` : `field:${series.y.sourceBindingId}:${series.y.field}`;
}
function makeMetricBinding(metric: MetricCatalogEntry, index: number) { return { id: `metric-${metric.id}-${index + 1}`, sourceId: 'metrics.series', params: { metric: metric.id }, filters: [], inherit: { vehicle: true, timeframe: true } }; }
function applySeriesChoice(definition: ChartDefinitionV1, index: number, choice: string, manifests: ChartSourceManifest[], metrics: MetricCatalogEntry[], onNotice: (notice: string | null) => void): ChartDefinitionV1 {
  if (choice.startsWith('field:')) {
    const [, sourceBindingId, field] = choice.split(':');
    const binding = definition.sources.find((source) => source.id === sourceBindingId);
    const manifest = manifests.find((candidate) => candidate.id === binding?.sourceId);
    const fieldDefinition = manifest?.fields.find((candidate) => candidate.id === field);
    if (!sourceBindingId || !field || !fieldDefinition) return definition;
    return { ...definition, series: definition.series.map((series, seriesIndex) => seriesIndex === index ? { ...series, label: fieldDefinition.label, y: { sourceBindingId, field } } : series) };
  }
  const metricId = choice.replace(/^metric:/, '');
  const metric = metrics.find((candidate) => candidate.id === metricId && candidate.supports_series);
  if (!metric) return definition;
  let binding = definition.sources.find((source) => source.sourceId === 'metrics.series' && source.params.metric === metric.id);
  let sources = definition.sources;
  if (!binding) {
    if (sources.length >= 4) { onNotice('This chart already uses the four-source limit. Remove or reuse a source before selecting another metric.'); return definition; }
    binding = makeMetricBinding(metric, sources.length);
    sources = [...sources, binding];
  }
  onNotice(null);
  return { ...definition, sources, series: definition.series.map((series, seriesIndex) => seriesIndex === index ? { ...series, label: metric.label, y: { sourceBindingId: binding!.id, field: metric.id }, x: { sourceBindingId: binding!.id, field: 'timestamp' } } : series) };
}
function addSeriesFromChoice(definition: ChartDefinitionV1, choice: string | undefined, manifests: ChartSourceManifest[], metrics: MetricCatalogEntry[], onNotice: (notice: string | null) => void) {
  if (!choice) return definition;
  const seed = newSeries(definition, definition.series[0]?.y.field ?? 'value', definition.series.length);
  return applySeriesChoice({ ...definition, series: [...definition.series, seed] }, definition.series.length, choice, manifests, metrics, onNotice);
}
function patchAxis(onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void, axis: 'x' | 'y' | 'y2', patch: Partial<ChartAxisDefinition>) { onChange((current) => { const existing = current.axes[axis]; if (!existing) return current; return { ...current, axes: { ...current.axes, [axis]: { ...existing, ...patch } } }; }); }
function AxisRangeEditor({ axis, definition, onChange }: { axis: 'x' | 'y' | 'y2'; definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const config = definition.axes[axis];
  if (!config) return null;
  const fixed = config.domain.mode === 'fixed';
  const fixedDomain = config.domain.mode === 'fixed' ? config.domain : null;
  return <div className="grid gap-3 rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium uppercase text-fg">{axis} range</span><Switch checked={fixed} onChange={(checked) => patchAxis(onChange, axis, { domain: checked ? { mode: 'fixed', min: 0, max: 100 } : { mode: 'auto' } })} aria-label={`Use fixed ${axis} range`} /></div>{fixedDomain ? <div className="grid grid-cols-2 gap-3"><EditorField label="Minimum"><input type="number" value={fixedDomain.min} onChange={(event) => patchAxis(onChange, axis, { domain: { mode: 'fixed', min: Number(event.target.value), max: fixedDomain.max } })} className="editor-input" /></EditorField><EditorField label="Maximum"><input type="number" value={fixedDomain.max} onChange={(event) => patchAxis(onChange, axis, { domain: { mode: 'fixed', min: fixedDomain.min, max: Number(event.target.value) } })} className="editor-input" /></EditorField></div> : null}</div>;
}
function patchSeries(onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void, index: number, patch: Partial<ChartSeriesDefinition>) { onChange((current) => ({ ...current, series: current.series.map((series, seriesIndex) => seriesIndex === index ? { ...series, ...patch } : series) })); }
function moveItem<T>(items: T[], from: number, to: number) { const next = [...items]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); return next; }
function newSeries(definition: ChartDefinitionV1, field: string, index: number): ChartSeriesDefinition { return { id: `series-${index + 1}`, label: field, y: { sourceBindingId: definition.sources[0]?.id ?? 'main', field }, mark: 'line', yAxis: 'y', color: { mode: 'token', token: TOKEN_COLORS[index % TOKEN_COLORS.length]!.token }, transforms: [], visibleInLegend: true }; }
