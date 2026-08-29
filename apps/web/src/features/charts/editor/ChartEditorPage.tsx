import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CHART_SOURCE_MANIFESTS,
  ManagedChartRuntime,
  ChartDefinitionV1Schema,
  downloadChartYaml,
  getBundledChartDefinition,
  resolveChartSourceCapabilities,
  validateChartDefinitionAgainstSources,
  buildCurveCatalog,
  isMixedDomain,
  removeCurveAndUnusedSources,
  sharedDomain,
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
import type { ChartAxisDefinition, ChartColorToken, ChartDefinitionV1, ChartMark, ChartRecord, ChartSeriesDefinition, ChartSourceBinding, ChartSourceManifest, MetricCatalogEntry } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Switch } from '@riviamigo/ui/primitives';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Download, Save, Search, Trash2 } from 'lucide-react';

type EditorSection = 'basics' | 'curves' | 'display' | 'advanced';

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

function previewRange(policy: ChartDefinitionV1['timeframe']) {
  if (policy.mode === 'lifetime') return { from: null, to: null, lifetime: true };
  const days = policy.mode === 'relative' ? ({ '1h': 1 / 24, '6h': 0.25, '24h': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[policy.preset] ?? 30) : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), lifetime: false };
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
  const [advancedError, setAdvancedError] = React.useState<{ path: string; message: string } | null>(null);
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
  const previewTimeframe = draft?.config.timeframe;
  const previewPreset = previewTimeframe?.mode === 'relative' ? previewTimeframe.preset : undefined;
  const previewContext = React.useMemo(
    () => previewRange(previewTimeframe ?? { mode: 'dashboard' }),
    [previewTimeframe?.mode, previewPreset],
  );
  const usesBundledPreview = !!draft && !!getBundledChartDefinition(draft.slug);
  const previewData = useChartDatasets(usesBundledPreview ? null : draft?.config ?? null, {
    vehicleId: effectiveVehicleId,
    from: previewContext.from,
    to: previewContext.to,
    lifetime: previewContext.lifetime,
  });

  React.useEffect(() => {
    if (mode !== 'edit' || !entry || dirty) return;
    const next = configRecord(entry.effective);
    setDraft(next);
    setAdvancedText(JSON.stringify(next.config, null, 2));
    setAdvancedError(null);
  }, [dirty, entry, mode]);

  React.useEffect(() => {
    if (!draft) return;
    setAdvancedText(JSON.stringify(draft.config, null, 2));
  }, [draft]);

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
    if (advancedError) return [advancedError, ...validateDraftConfig(draft.config, manifests)];
    return validateDraftConfig(draft.config, manifests);
  }, [advancedError, draft, manifests]);

  function validateDraftConfig(config: ChartDefinitionV1, sourceManifests: typeof manifests) {
    try {
      const parsed = ChartDefinitionV1Schema.safeParse(config);
      if (!parsed.success) return parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return validateChartDefinitionAgainstSources(config, sourceManifests);
    } catch (error) {
      return [{ path: 'config', message: errorText(error) }];
    }
  }

  function updateDraft(patch: Partial<ChartRecord>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setDirty(true);
    setSaveError(null);
  }

  function updateDefinition(mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) {
    setDraft((current) => current ? { ...current, config: mutator(current.config) } : current);
    setAdvancedError(null);
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
      const firstPath = validationErrors[0]?.path ?? '';
      setSection(firstPath === 'advanced' ? 'advanced' : firstPath.startsWith('config.sources') || firstPath.startsWith('config.series') ? 'curves' : 'display');
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
        <PreviewPanel draft={draft} errors={validationErrors} datasets={previewData.datasets} loading={previewData.isLoading} sourceErrors={previewData.errors} previewContext={previewContext} vehicleId={effectiveVehicleId} usesBundledPreview={usesBundledPreview} />
        <section className="min-w-0 lg:col-start-2 lg:row-start-1">
          <nav aria-label="Chart editor sections" className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg-surface p-1">
            {(['basics', 'curves', 'display', 'advanced'] as EditorSection[]).map((item) => <button key={item} type="button" onClick={() => setSection(item)} className={`min-h-10 shrink-0 rounded-lg px-3 text-left text-sm capitalize transition-colors ${section === item ? 'bg-bg-elevated font-medium text-fg' : 'text-fg-secondary hover:bg-bg-elevated/70'}`}>{item}</button>)}
          </nav>
          {saveError ? <div role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{saveError}</div> : null}
          {sourceNotice ? <div role="status" className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-fg-secondary">{sourceNotice}</div> : null}
          {section === 'basics' && <BasicsSection draft={draft} onChange={updateDraft} />}
          {section === 'curves' && <CurvesSection definition={draft.config} manifests={manifests} metrics={metricCatalog.data ?? []} onNotice={setSourceNotice} onChange={updateDefinition} />}
          {section === 'display' && <DisplaySection definition={draft.config} onChange={updateDefinition} />}
          {section === 'advanced' && <AdvancedSection value={advancedText} onChange={(value) => {
            setAdvancedText(value);
            try {
              const parsed = ChartDefinitionV1Schema.safeParse(JSON.parse(value));
              if (!parsed.success) {
                setAdvancedError({ path: 'advanced', message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ') });
                setDirty(true);
                return;
              }
              setAdvancedError(null);
              updateDefinition(() => parsed.data as ChartDefinitionV1);
            } catch (error) {
              setAdvancedError({ path: 'advanced', message: error instanceof Error ? error.message : 'Invalid JSON.' });
              setDirty(true);
            }
          }} />}
        </section>
      </main>
      {discardRequested ? <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-bg-page/85 sm:items-center sm:p-4"><div ref={discardDialogRef} role="dialog" aria-modal="true" aria-labelledby="discard-chart-title" className="flex min-h-[100dvh] w-full flex-col bg-bg-surface p-[max(1.25rem,env(safe-area-inset-top))] shadow-lg sm:min-h-0 sm:max-w-md sm:rounded-xl sm:border sm:border-border sm:p-5"><h2 id="discard-chart-title" className="text-base font-semibold">Discard unsaved changes?</h2><p className="mt-2 text-sm text-fg-tertiary">Your chart draft will not be saved.</p><div className="mt-auto flex flex-col-reverse gap-2 pt-6 sm:mt-5 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" size="md" onClick={() => setDiscardRequested(false)}>Keep editing</Button><Button type="button" variant="danger" size="md" onClick={discardAndGoBack}>Discard changes</Button></div></div></div> : null}
    </div>
  );
}

function BasicsSection({ draft, onChange }: { draft: ChartRecord; onChange: (patch: Partial<ChartRecord>) => void }) {
  return <EditorCard title="Basics" description="Stable slugs keep favorites and dashboard settings attached to the same chart."><div className="grid gap-4"><EditorField label="Name"><input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} className="editor-input" /></EditorField><EditorField label="Slug" hint="Locked after first save in the production editor."><input value={draft.slug} disabled={!!draft.id} onChange={(event) => onChange({ slug: event.target.value })} className="editor-input disabled:opacity-60" /></EditorField><EditorField label="Description"><textarea value={draft.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} rows={3} className="editor-input py-2" /></EditorField><ToggleRow label="Enabled" description="Disabled charts remain saved but are hidden from assigned dashboards." checked={draft.isEnabled} onCheckedChange={(checked) => onChange({ isEnabled: checked })} /></div></EditorCard>;
}

function CurvesSection({ definition, manifests, metrics, onNotice, onChange }: { definition: ChartDefinitionV1; manifests: ChartSourceManifest[]; metrics: MetricCatalogEntry[]; onNotice: (notice: string | null) => void; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const [query, setQuery] = React.useState('');
  const domain = sharedDomain(definition, manifests);
  const catalog = buildCurveCatalog(manifests, metrics, definition);
  const mixed = isMixedDomain(definition, manifests);
  const filtered = catalog.filter((option) => `${option.label} ${option.category} ${option.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="grid gap-4"><EditorCard title="Curves" description="Build the chart from searchable sensors and values. Each curve keeps its own mark, color, and axis."><div className="grid gap-4"><EditorField label="Timeframe"><select value={definition.timeframe.mode === 'relative' ? definition.timeframe.preset : definition.timeframe.mode} onChange={(event) => onChange((current) => ({ ...current, timeframe: event.target.value === 'dashboard' ? { mode: 'dashboard' } : event.target.value === 'lifetime' ? { mode: 'lifetime' } : { mode: 'relative', preset: event.target.value as '24h' | '7d' | '30d' | '90d' | '1y' } }))} className="editor-input"><option value="dashboard">Dashboard range</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="1y">Last year</option><option value="lifetime">Lifetime</option></select></EditorField><div className="rounded-lg border border-border bg-bg-elevated/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Plotted over</p><p className="mt-1 text-sm text-fg">{domain.label}{domain.unit ? ` · ${domain.unit}` : ''}</p>{mixed ? <p className="mt-1 text-xs text-warning">This chart uses mixed domains; curve changes are disabled. Use Advanced for exact bindings.</p> : null}</div><details className="rounded-lg border border-border bg-bg-elevated/20 p-3"><summary className="cursor-pointer text-sm font-medium">Add curve</summary><div className="mt-3 grid gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search curves" aria-label="Search curves" className="editor-input" /><div className="grid gap-1">{filtered.map((option) => <button key={option.id} type="button" disabled={!option.enabled || mixed} title={option.disabledReason} className="flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-45" onClick={() => onChange((current) => addSeriesFromChoice(current, option.id, manifests, metrics, onNotice))}><span><span className="block">{option.label}</span><span className="block text-xs text-fg-tertiary">{option.category} · {option.description}</span>{!option.enabled || mixed ? <span className="block text-xs text-warning">{mixed ? 'Mixed-domain chart; edit in Advanced.' : option.disabledReason ?? 'Unavailable for this chart.'}</span> : null}</span></button>)}{filtered.length === 0 ? <p className="px-3 py-4 text-sm text-fg-tertiary">No matching curves.</p> : null}</div></div></details><CurvesListSection definition={definition} manifests={manifests} metrics={metrics} onNotice={onNotice} onChange={onChange} /></div></EditorCard></div>;
}

function CurvesListSection({ definition, manifests, metrics, onNotice, onChange }: { definition: ChartDefinitionV1; manifests: ChartSourceManifest[]; metrics: MetricCatalogEntry[]; onNotice: (notice: string | null) => void; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  const mixed = isMixedDomain(definition, manifests);
  const replacementDefinition = definition.series.length === 1 ? { ...definition, series: [] } : definition;
  const catalog = buildCurveCatalog(manifests, metrics, replacementDefinition);
  return <div className="grid gap-3">{definition.series.map((series, index) => {
    const binding = definition.sources.find((candidate) => candidate.id === series.y.sourceBindingId);
    const manifest = manifests.find((candidate) => candidate.id === binding?.sourceId);
    const valueOptions: SearchOption[] = catalog.map((option) => ({
      value: option.id,
      label: option.label,
      description: `${option.category} · ${option.description}`,
      disabled: mixed || !option.enabled,
      ...((mixed || option.disabledReason) ? { disabledReason: mixed ? 'Mixed-domain chart; edit exact values in Advanced.' : option.disabledReason! } : {}),
    }));
    const inheritanceKeys: Array<'vehicle' | 'timeframe' | 'tripTags'> = ['vehicle', 'timeframe', ...(manifest?.supportsTripTagInheritance ? ['tripTags' as const] : [])];
    return <div key={series.id} className="grid gap-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">Curve {index + 1}</strong><div className="flex gap-1"><button type="button" aria-label="Move curve up" disabled={index === 0} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index - 1) }))} className="icon-button"><ChevronUp className="h-4 w-4" /></button><button type="button" aria-label="Move curve down" disabled={index === definition.series.length - 1} onClick={() => onChange((current) => ({ ...current, series: moveItem(current.series, index, index + 1) }))} className="icon-button"><ChevronDown className="h-4 w-4" /></button><button type="button" aria-label="Remove curve" disabled={definition.series.length === 1} onClick={() => onChange((current) => removeCurveAndUnusedSources(current, index))} className="icon-button text-danger"><Trash2 className="h-4 w-4" /></button></div></div>
      <EditorField label="Value"><SearchPicker value={choiceValueForSeries(series, definition)} options={valueOptions} onChange={(choice) => onChange((current) => applySeriesChoice(current, index, choice, manifests, metrics, onNotice))} ariaLabel={`Curve ${index + 1} value`} /></EditorField>
      <EditorField label="Label"><input value={series.label} onChange={(event) => patchSeries(onChange, index, { label: event.target.value })} className="editor-input" /></EditorField>
      <div className="grid gap-3 sm:grid-cols-2"><EditorField label="Mark"><select value={series.mark} onChange={(event) => patchSeries(onChange, index, { mark: event.target.value as ChartMark })} className="editor-input">{MARKS.map((mark) => <option key={mark} value={mark}>{mark}</option>)}</select></EditorField><EditorField label="Axis"><select value={series.yAxis} onChange={(event) => patchSeries(onChange, index, { yAxis: event.target.value as 'y' | 'y2' })} className="editor-input"><option value="y">Left axis</option><option value="y2">Right axis</option></select></EditorField><EditorField label="Color"><select value={series.color.mode === 'token' ? series.color.token : 'accent'} onChange={(event) => patchSeries(onChange, index, { color: { mode: 'token', token: event.target.value as ChartColorToken } })} className="editor-input">{TOKEN_COLORS.map((color) => <option key={color.token} value={color.token}>{color.label}</option>)}</select></EditorField></div>
      <ToggleRow label="Show in legend" checked={series.visibleInLegend !== false} onCheckedChange={(checked) => patchSeries(onChange, index, { visibleInLegend: checked })} />
      <details className="rounded-lg border border-border bg-bg-elevated/20 p-2"><summary className="cursor-pointer text-sm font-medium">Data settings</summary><div className="mt-3 grid gap-3">{binding ? <>{inheritanceKeys.map((key) => <ToggleRow key={key} label={key === 'tripTags' ? 'Use trip filters' : key === 'vehicle' ? 'Use active vehicle' : 'Use selected timeframe'} checked={binding.inherit[key] ?? false} onCheckedChange={(checked) => onChange((current) => ({ ...current, sources: current.sources.map((candidate) => candidate.id === binding.id ? { ...candidate, inherit: { ...candidate.inherit, [key]: checked } } : candidate) }))} />)}{manifest?.requiredContext.includes('chargeSession') ? <p className="rounded-lg border border-border bg-bg-elevated/30 p-3 text-xs text-fg-tertiary">Uses the active charging session when this chart is viewed in a charging-session context.</p> : null}</> : <p className="text-xs text-warning">This curve's data settings are unavailable. Choose another value or repair it in Advanced.</p>}</div></details>
    </div>;
  })}</div>;
}

function DisplaySection({ definition, onChange }: { definition: ChartDefinitionV1; onChange: (mutator: (definition: ChartDefinitionV1) => ChartDefinitionV1) => void }) {
  return <EditorCard title="Display and interaction" description="Preview the exact labels, marks, and interaction settings that will be saved."><div className="grid gap-5"><div className="grid gap-4"><h3 className="text-sm font-semibold text-fg">Axis labels</h3><EditorField label="X axis label"><input value={definition.axes.x.label ?? ''} onChange={(event) => patchAxis(onChange, 'x', { label: event.target.value })} className="editor-input" /></EditorField><EditorField label="Y axis label"><input value={definition.axes.y.label ?? ''} onChange={(event) => patchAxis(onChange, 'y', { label: event.target.value })} className="editor-input" /></EditorField><ToggleRow label="Right Y axis" description="Adds a separately labeled scale for series assigned to the right axis." checked={!!definition.axes.y2} onCheckedChange={(checked) => onChange((current) => ({ ...current, axes: checked ? { ...current.axes, y2: current.axes.y2 ?? { scale: 'linear', domain: { mode: 'auto' } } } : { x: current.axes.x, y: current.axes.y }, series: checked ? current.series : current.series.map((series) => ({ ...series, yAxis: 'y' as const })) }))} />{definition.axes.y2 ? <EditorField label="Right Y axis label"><input value={definition.axes.y2.label ?? ''} onChange={(event) => patchAxis(onChange, 'y2', { label: event.target.value })} className="editor-input" /></EditorField> : null}</div><div className="border-t border-border pt-5"><h3 className="mb-4 text-sm font-semibold text-fg">Ranges</h3><div className="grid gap-3">{(['x', 'y', ...(definition.axes.y2 ? ['y2'] : [])] as Array<'x' | 'y' | 'y2'>).map((axis) => <AxisRangeEditor key={axis} axis={axis} definition={definition} onChange={onChange} />)}</div></div><div className="grid gap-4 border-t border-border pt-5"><div className="grid gap-3 sm:grid-cols-2"><EditorField label="Legend"><select value={definition.display.legend} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, legend: event.target.value as ChartDefinitionV1['display']['legend'] } }))} className="editor-input"><option value="auto">Auto</option><option value="show">Show</option><option value="hide">Hide</option></select></EditorField><EditorField label="Curve smoothness"><select value={definition.display.curveSmoothness} onChange={(event) => onChange((current) => ({ ...current, display: { ...current.display, curveSmoothness: event.target.value as ChartDefinitionV1['display']['curveSmoothness'] } }))} className="editor-input"><option value="straight">Straight</option><option value="gentle">Gentle</option><option value="smooth">Smooth</option></select></EditorField></div><ToggleRow label="Show grid" checked={definition.display.grid} onCheckedChange={(checked) => onChange((current) => ({ ...current, display: { ...current.display, grid: checked } }))} /><ToggleRow label="Enable tooltip" checked={definition.display.tooltip} onCheckedChange={(checked) => onChange((current) => ({ ...current, display: { ...current.display, tooltip: checked } }))} /></div></div></EditorCard>;
}

function AdvancedSection({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <EditorCard title="Advanced definition" description="JSON is validated by the same schema used for visual controls. Unsupported executable content is rejected."><textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} rows={24} className="min-h-[30rem] w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-xs text-fg outline-none focus:border-accent" /></EditorCard>;
}

function PreviewPanel({ draft, errors, datasets, loading, sourceErrors, previewContext, vehicleId, usesBundledPreview }: { draft: ChartRecord; errors: Array<{ path: string; message: string }>; datasets: import('@riviamigo/types').ChartDataset[]; loading: boolean; sourceErrors: unknown[]; previewContext: { from: string | null; to: string | null; lifetime: boolean }; vehicleId: string | null; usesBundledPreview: boolean }) {
  const totalIssues = errors.length + sourceErrors.length;
  const ctx = { vehicleId, from: previewContext.from, to: previewContext.to };
  const contextLabel = previewContext.lifetime
    ? 'Active vehicle · Lifetime'
    : `Active vehicle · ${previewContext.from?.slice(0, 10) ?? 'range start'} to ${previewContext.to?.slice(0, 10) ?? 'range end'}`;
  return <aside className="grid content-start gap-4 lg:sticky lg:top-24 lg:self-start"><Card><CardHeader><CardTitle>Live preview</CardTitle><Badge variant={totalIssues ? 'warning' : 'success'} size="sm">{totalIssues ? `${totalIssues} issue${totalIssues === 1 ? '' : 's'}` : 'Valid'}</Badge></CardHeader><CardContent><div className="min-h-56 rounded-xl border border-border bg-bg-elevated/30 p-2"><ManagedChartRuntime chart={draft} ctx={ctx} height={260} /></div><p className="mt-3 text-xs text-fg-tertiary">{contextLabel}. This preview uses the unsaved draft and the production chart renderer.</p></CardContent></Card><Card><CardHeader><CardTitle>Diagnostics</CardTitle></CardHeader><CardContent className="grid gap-2 text-xs">{errors.map((error) => <div key={`${error.path}-${error.message}`} className="rounded-lg border border-danger/30 bg-danger/10 p-2"><strong className="text-danger">{error.path}</strong><p className="mt-1 text-fg-secondary">{error.message}</p></div>)}{sourceErrors.map((error, index) => <div key={index} className="rounded-lg border border-danger/30 bg-danger/10 p-2"><strong className="text-danger">Data request</strong><p className="mt-1 text-fg-secondary">{error instanceof Error ? error.message : 'Data request failed.'}</p></div>)}{totalIssues === 0 ? <><div className="flex items-center gap-2 text-success"><Check className="h-4 w-4" /> {usesBundledPreview ? 'Bundled dashboard renderer' : loading ? 'Loading data…' : `${datasets.length} data group${datasets.length === 1 ? '' : 's'}`}</div><div className="flex items-center gap-2 text-success"><Check className="h-4 w-4" /> {draft.config.series.length} curves</div></> : null}</CardContent></Card></aside>;
}

function EditorCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><div><CardTitle>{title}</CardTitle><p className="mt-1 text-sm text-fg-tertiary">{description}</p></div></CardHeader><CardContent>{children}</CardContent></Card>; }
function EditorField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</span>{children}{hint ? <span className="text-xs text-fg-tertiary">{hint}</span> : null}</label>; }
function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) { return <div className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2"><div><p className="text-sm font-medium text-fg">{label}</p>{description ? <p className="mt-0.5 text-xs text-fg-tertiary">{description}</p> : null}</div><Switch checked={checked} onChange={onCheckedChange} aria-label={label} /></div>; }
type SearchOption = { value: string; label: string; description?: string; disabled?: boolean; disabledReason?: string };
function SearchPicker({ value, options, onChange, ariaLabel }: { value: string; options: SearchOption[]; onChange: (value: string) => void; ariaLabel: string }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative"><button type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="editor-input flex min-h-10 items-center justify-between gap-2 text-left"><span className="min-w-0"><span className="block truncate text-sm text-fg">{selected?.label ?? 'Choose a field'}</span>{selected?.description ? <span className="block truncate text-xs text-fg-tertiary">{selected.description}</span> : null}</span><Search className="h-4 w-4 shrink-0 text-fg-tertiary" /></button>{open ? <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-bg-surface shadow-lg"><div className="border-b border-border p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search…" aria-label={`Search ${ariaLabel}`} className="editor-input" /></div><div role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto p-1">{filtered.map((option) => <button key={option.value} type="button" role="option" disabled={option.disabled} title={option.disabledReason} aria-selected={option.value === value} onClick={() => { if (option.disabled) return; onChange(option.value); setQuery(''); setOpen(false); }} className={`block w-full rounded-md px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45 ${option.value === value ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-bg-elevated'}`}><span className="block text-sm font-medium">{option.label}</span>{option.description ? <span className="block text-xs text-fg-tertiary">{option.description}</span> : null}{option.disabledReason ? <span className="block text-xs text-warning">{option.disabledReason}</span> : null}</button>)}{filtered.length === 0 ? <p className="px-3 py-5 text-center text-sm text-fg-tertiary">No matching fields</p> : null}</div></div> : null}</div>;
}

function choiceValueForSeries(series: ChartSeriesDefinition, definition: ChartDefinitionV1) {
  const binding = definition.sources.find((source) => source.id === series.y.sourceBindingId);
  return binding?.sourceId === 'metrics.series' ? `metric:${String(binding.params.metric ?? series.y.field)}` : `field:${binding?.sourceId ?? series.y.sourceBindingId}:${series.y.field}`;
}
function makeMetricBinding(metric: MetricCatalogEntry, index: number) { return { id: `metric-${metric.id}-${index + 1}`, sourceId: 'metrics.series', params: { metric: metric.id }, filters: [], inherit: { vehicle: true, timeframe: true } }; }
function applySeriesChoice(definition: ChartDefinitionV1, index: number, choice: string, manifests: ChartSourceManifest[], metrics: MetricCatalogEntry[], onNotice: (notice: string | null) => void): ChartDefinitionV1 {
  const changesSharedDomain = definition.series.length === 1;
  const compatibilityDefinition = changesSharedDomain ? { ...definition, series: [] } : definition;
  const selected = buildCurveCatalog(manifests, metrics, compatibilityDefinition).find((option) => option.id === choice);
  if (!selected || !selected.enabled || !selected.field) {
    onNotice(selected?.disabledReason ?? 'That curve is not available for this chart.');
    return definition;
  }

  let binding: ChartSourceBinding | undefined = selected.sourceId === 'metrics.series'
    ? definition.sources.find((source) => source.sourceId === selected.sourceId && source.params.metric === selected.field)
    : definition.sources.find((source) => source.sourceId === selected.sourceId);
  let sources = definition.sources;
  if (!binding) {
    if (sources.length >= 4) {
      onNotice('This chart can combine up to four data groups. Remove a curve that uses another group before adding this one.');
      return definition;
    }
    if (selected.sourceId === 'metrics.series') {
      const metric = metrics.find((candidate) => candidate.id === selected.field && candidate.supports_series);
      if (!metric) return definition;
      binding = makeMetricBinding(metric, sources.length);
    } else {
      const manifest = manifests.find((candidate) => candidate.id === selected.sourceId);
      binding = {
        id: `source-${selected.sourceId}-${sources.length + 1}`,
        sourceId: selected.sourceId,
        params: {},
        filters: [],
        inherit: { vehicle: true, timeframe: true, ...(manifest?.supportsTripTagInheritance ? { tripTags: true } : {}) },
      };
    }
    sources = [...sources, binding];
  }

  const resolvedBinding = binding;
  const series = definition.series.map((curve, seriesIndex) => seriesIndex === index ? {
    ...curve,
    label: selected.label,
    x: { sourceBindingId: resolvedBinding.id, field: selected.domainKey },
    y: { sourceBindingId: resolvedBinding.id, field: selected.field! },
  } : curve);
  const xWithoutUnit = { ...definition.x };
  delete xWithoutUnit.unit;
  const x = changesSharedDomain ? {
    ...xWithoutUnit,
    field: { sourceBindingId: resolvedBinding.id, field: selected.domainKey },
    kind: selected.domainKind,
    ...(selected.domainUnit ? { unit: selected.domainUnit } : {}),
  } : definition.x;
  const referenced = new Set([x.field.sourceBindingId, ...series.flatMap((curve) => [curve.y.sourceBindingId, ...(curve.x ? [curve.x.sourceBindingId] : [])])]);
  onNotice(null);
  return { ...definition, x, sources: sources.filter((source) => referenced.has(source.id)), series };
}
function addSeriesFromChoice(definition: ChartDefinitionV1, choice: string | undefined, manifests: ChartSourceManifest[], metrics: MetricCatalogEntry[], onNotice: (notice: string | null) => void) {
  if (!choice) return definition;
  const selected = buildCurveCatalog(manifests, metrics, definition).find((option) => option.id === choice);
  if (!selected?.enabled) {
    onNotice(selected?.disabledReason ?? 'That curve is not available for this chart.');
    return definition;
  }
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
