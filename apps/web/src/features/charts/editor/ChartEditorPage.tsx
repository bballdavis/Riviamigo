import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CHART_SOURCE_MANIFESTS,
  ChartDefinitionRenderer,
  ChartDefinitionV1Schema,
  downloadChartYaml,
  getBundledChartDefinition,
  validateChartDefinitionAgainstSources,
} from '@riviamigo/dashboards';
import {
  useChartManager,
  useChartSources,
  useChartDatasets,
  useResolvedVehicleSelection,
  useCreateChart,
  useUpdateChart,
} from '@riviamigo/hooks';
import type { ChartColorToken, ChartDefinitionV1, ChartMark, ChartRecord, ChartSeriesDefinition } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Download, Plus, Save, Trash2 } from 'lucide-react';

type EditorSection = 'basics' | 'sources' | 'domain' | 'series' | 'axes' | 'display' | 'advanced';

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
  const entry = manager.data?.find((candidate) => candidate.effective.id === chartId);
  const manifests = React.useMemo(() => sources.data && sources.data.some((source) => source.fields.length > 0) ? sources.data : [...CHART_SOURCE_MANIFESTS], [sources.data]);
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
      setSection(validationErrors[0]?.path.startsWith('config.sources') ? 'sources' : validationErrors[0]?.path.startsWith('config.series') ? 'series' : 'basics');
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
          <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="h-4 w-4" />} onClick={goBack}>Back</Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-base font-semibold">{draft.name}</h1><Badge variant={entry?.origin === 'system' ? 'info' : 'default'} size="sm">{entry?.origin === 'system' ? 'Customize app default' : mode === 'new' ? 'New chart' : 'My chart'}</Badge>{dirty ? <span className="text-xs text-fg-tertiary">Unsaved changes</span> : null}</div>
            <p className="truncate text-xs text-fg-tertiary">{draft.slug}</p>
          </div>
          <Button variant="secondary" size="sm" iconLeft={<Download className="h-4 w-4" />} onClick={() => { if (draft.id) downloadChartYaml(draft); else setSaveError('Save the chart before exporting it.'); }}>Export</Button>
          <Button variant="primary" size="sm" iconLeft={<Save className="h-4 w-4" />} loading={createChart.isPending || updateChart.isPending} onClick={() => { void save(); }}>Save</Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 md:p-6 lg:grid-cols-[13rem_minmax(0,1fr)_minmax(18rem,32rem)]">
        <nav aria-label="Chart editor sections" className="flex gap-2 overflow-x-auto lg:grid lg:content-start lg:overflow-visible">
          {(['basics', 'sources', 'domain', 'series', 'axes', 'display', 'advanced'] as EditorSection[]).map((item) => <button key={item} type="button" onClick={() => setSection(item)} className={`min-h-11 shrink-0 rounded-lg px-3 text-left text-sm capitalize ${section === item ? 'bg-bg-elevated font-medium text-fg' : 'text-fg-secondary hover:bg-bg-elevated/70'}`}>{item}</button>)}
        </nav>
        <section className="min-w-0">
          {saveError ? <div role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{saveError}</div> : null}
          {section === 'basics' && <BasicsSection draft={draft} onChange={updateDraft} />}
          {section === 'sources' && <SourcesSection definition={draft.config} manifests={manifests} onChange={updateDefinition} />}
          {section === 'domain' && <DomainSection definition={draft.config} onChange={updateDefinition} />}
          {section === 'series' && <SeriesSection definition={draft.config} manifests={manifests} onChange={updateDefinition} />}
          {section === 'axes' && <AxesSection definition={draft.config} onChange={updateDefinition} />}
          {section === 'display' && <DisplaySection definition={draft.config} onChange={updateDefinition} />}
          {section === 'advanced' && <AdvancedSection value={advancedText} onChange={(value) => { setAdvancedText(value); try { updateDefinition(() => ChartDefinitionV1Schema.parse(JSON.parse(value)) as ChartDefinitionV1); } catch { setDirty(true); } }} />}
        </section>
        <PreviewPanel draft={draft} errors={validationErrors} datasets={previewData.datasets} loading={previewData.isLoading} sourceErrors={previewData.errors} />
      </main>
      {discardRequested ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page/80 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="discard-chart-title" className="w-full max-w-md rounded-xl border border-border bg-bg-surface p-5 shadow-lg"><h2 id="discard-chart-title" className="text-base font-semibold">Discard unsaved changes?</h2><p className="mt-2 text-sm text-fg-tertiary">Your chart draft will not be saved.</p><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" size="md" onClick={() => setDiscardRequested(false)}>Keep editing</Button><Button type="button" variant="danger" size="md" onClick={discardAndGoBack}>Discard changes</Button></div></div></div> : null}
    </div>
  );
}

function BasicsSection({ draft, onChange }: { draft: ChartRecord; onChange: (patch: Partial<ChartRecord>) => void }) {
  return <EditorCard title="Basics" description="Stable slugs keep favorites and dashboard settings attached to the same chart."><div className="grid gap-4"><EditorField label="Name"><input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} className="editor-input" /></EditorField><EditorField label="Slug" hint="Locked after first save in the production editor."><input value={draft.slug} disabled={!!draft.id} onChange={(event) => onChange({ slug: event.target.value })} className="editor-input disabled:opacity-60" /></EditorField><EditorField label="Description"><textarea value={draft.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} rows={3} className="editor-input py-2" /></EditorField><label className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 text-sm"><span>Enabled</span><input type="checkbox" checked={draft.isEnabled} onChange={(event) => onChange({ isEnabled: event.target.checked })} /></label></div></EditorCard>;
}

function SourcesSection({ definition, manifests, onChange }: { definition: ChartDefinitionV1; manifests: Array<{ id: string; label: string; description: string }>; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const source = definition.sources[0];
  return <EditorCard title="Data sources" description="Only allowlisted Riviamigo sources can be used by a saved chart."><div className="grid gap-4"><EditorField label="Source"><select value={source?.sourceId ?? ''} onChange={(event) => onChange((current) => ({ ...current, sources: current.sources.map((binding, index) => index === 0 ? { ...binding, sourceId: event.target.value } : binding) }))} className="editor-input">{manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.label}</option>)}</select></EditorField><div className="rounded-lg border border-border bg-bg-elevated/30 p-3 text-sm text-fg-secondary">{manifests.find((manifest) => manifest.id === source?.sourceId)?.description ?? 'Source capability metadata is loading.'}</div><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={source?.inherit.vehicle ?? true} onChange={(event) => onChange((current) => ({ ...current, sources: current.sources.map((binding, index) => index === 0 ? { ...binding, inherit: { ...binding.inherit, vehicle: event.target.checked } } : binding) }))} /> Inherit active vehicle</label><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={source?.inherit.timeframe ?? true} onChange={(event) => onChange((current) => ({ ...current, sources: current.sources.map((binding, index) => index === 0 ? { ...binding, inherit: { ...binding.inherit, timeframe: event.target.checked } } : binding) }))} /> Inherit dashboard timeframe</label></div></EditorCard>;
}

function DomainSection({ definition, onChange }: { definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const source = definition.sources[0];
  return <EditorCard title="X axis and domain" description="Time-domain charts follow the dashboard range unless an explicit policy is selected."><div className="grid gap-4 md:grid-cols-2"><EditorField label="X field"><input value={definition.x.field.field} onChange={(event) => onChange((current) => ({ ...current, x: { ...current.x, field: { ...current.x.field, field: event.target.value } } }))} className="editor-input" /></EditorField><EditorField label="Domain kind"><select value={definition.x.kind} onChange={(event) => onChange((current) => ({ ...current, x: { ...current.x, kind: event.target.value as ChartDefinitionV1['x']['kind'] } }))} className="editor-input"><option value="time">Time</option><option value="number">Number</option><option value="category">Category</option></select></EditorField><EditorField label="Timeframe policy"><select value={definition.timeframe.mode} onChange={(event) => onChange((current) => ({ ...current, timeframe: event.target.value === 'dashboard' ? { mode: 'dashboard' } : event.target.value === 'lifetime' ? { mode: 'lifetime' } : { mode: 'relative', preset: '30d' } }))} className="editor-input"><option value="dashboard">Dashboard</option><option value="30d">Relative 30 days</option><option value="lifetime">Lifetime</option></select></EditorField><div className="rounded-lg border border-border bg-bg-elevated/30 p-3 text-xs text-fg-tertiary">Binding: {source?.id ?? 'none'} · X references a field from the selected trusted source.</div></div></EditorCard>;
}

function SeriesSection({ definition, manifests, onChange }: { definition: ChartDefinitionV1; manifests: Array<{ id: string; fields: Array<{ id: string; label: string; roles: string[] }> }>; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const fields = manifests.find((manifest) => manifest.id === definition.sources[0]?.sourceId)?.fields.filter((field) => field.roles.includes('y')) ?? [];
  return <EditorCard title="Series" description="Each series can choose its own mark, axis, color, and label."><div className="grid gap-3">{definition.series.map((series, index) => <div key={series.id} className="grid gap-3 rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">Series {index + 1}</strong><div className="flex gap-1"><button type="button" aria-label="Move series up" disabled={index === 0} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index - 1) }))} className="icon-button"><ChevronUp className="h-4 w-4" /></button><button type="button" aria-label="Move series down" disabled={index === definition.series.length - 1} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index + 1) }))} className="icon-button"><ChevronDown className="h-4 w-4" /></button><button type="button" aria-label="Remove series" onClick={() => onChange((current) => ({ ...current, series: current.series.filter((_, seriesIndex) => seriesIndex !== index) }))} className="icon-button text-danger"><Trash2 className="h-4 w-4" /></button></div></div><div className="grid gap-3 md:grid-cols-2"><EditorField label="Label"><input value={series.label} onChange={(event) => patchSeries(onChange, index, { label: event.target.value })} className="editor-input" /></EditorField><EditorField label="Y field"><select value={series.y.field} onChange={(event) => patchSeries(onChange, index, { y: { ...series.y, field: event.target.value } })} className="editor-input">{fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}<option value={series.y.field}>{series.y.field}</option></select></EditorField><EditorField label="Mark"><select value={series.mark} onChange={(event) => patchSeries(onChange, index, { mark: event.target.value as ChartMark })} className="editor-input">{MARKS.map((mark) => <option key={mark} value={mark}>{mark}</option>)}</select></EditorField><EditorField label="Y axis"><select value={series.yAxis} onChange={(event) => patchSeries(onChange, index, { yAxis: event.target.value as 'y' | 'y2' })} className="editor-input"><option value="y">Left axis</option><option value="y2">Right axis</option></select></EditorField><EditorField label="Color"><select value={series.color.mode === 'token' ? series.color.token : 'accent'} onChange={(event) => patchSeries(onChange, index, { color: { mode: 'token', token: event.target.value as ChartColorToken } })} className="editor-input">{TOKEN_COLORS.map((color) => <option key={color.token} value={color.token}>{color.label}</option>)}</select></EditorField></div></div>)}<Button variant="secondary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => onChange((current) => ({ ...current, series: [...current.series, newSeries(current, fields[0]?.id ?? current.x.field.field, current.series.length)] }))}>Add series</Button></div></EditorCard>;
}

function AxesSection({ definition, onChange }: { definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  return <EditorCard title="Axes and ranges" description="Auto ranges preserve the existing renderer behavior; fixed ranges are validated before save."><div className="grid gap-4 md:grid-cols-2">{(['x', 'y'] as const).map((axis) => <EditorField key={axis} label={`${axis.toUpperCase()} axis label`}><input value={definition.axes[axis].label ?? ''} onChange={(event) => onChange((current) => ({ ...current, axes: { ...current.axes, [axis]: { ...current.axes[axis], label: event.target.value } } }))} className="editor-input" /></EditorField>)}<label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={!!definition.axes.y2} onChange={(event) => onChange((current) => { const axes = event.target.checked ? { ...current.axes, y2: { scale: 'linear' as const, domain: { mode: 'auto' as const } } } : { x: current.axes.x, y: current.axes.y }; return { ...current, axes }; })} /> Enable right Y axis</label></div></EditorCard>;
}

function DisplaySection({ definition, onChange }: { definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  return <EditorCard title="Display and interaction" description="Curve smoothness changes the path between samples. Data smoothing changes displayed values through an explicit transform."><div className="grid gap-4 md:grid-cols-2"><EditorField label="Legend"><select value={definition.display.legend} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, legend: event.target.value as ChartDefinitionV1['display']['legend'] } }))} className="editor-input"><option value="auto">Auto</option><option value="show">Show</option><option value="hide">Hide</option></select></EditorField><EditorField label="Curve smoothness"><select value={definition.display.curveSmoothness} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, curveSmoothness: event.target.value as ChartDefinitionV1['display']['curveSmoothness'] } }))} className="editor-input"><option value="straight">Straight</option><option value="gentle">Gentle</option><option value="smooth">Smooth</option></select></EditorField><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={definition.display.grid} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, grid: event.target.checked } }))} /> Show grid</label><label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="checkbox" checked={definition.display.tooltip} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, tooltip: event.target.checked } }))} /> Enable tooltip</label></div></EditorCard>;
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
function patchSeries(onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void, index: number, patch: Partial<ChartSeriesDefinition>) { onChange((current) => ({ ...current, series: current.series.map((series, seriesIndex) => seriesIndex === index ? { ...series, ...patch } : series) })); }
function moveItem<T>(items: T[], from: number, to: number) { const next = [...items]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); return next; }
function newSeries(definition: ChartDefinitionV1, field: string, index: number): ChartSeriesDefinition { return { id: `series-${index + 1}`, label: field, y: { sourceBindingId: definition.sources[0]?.id ?? 'main', field }, mark: 'line', yAxis: 'y', color: { mode: 'token', token: TOKEN_COLORS[index % TOKEN_COLORS.length]!.token }, transforms: [], visibleInLegend: true }; }
