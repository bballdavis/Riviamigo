import React, { useState, useCallback } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { v4 as uuidv4 } from 'uuid';
import { X, GripVertical, Plus, AlignHorizontalDistributeCenter, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useMetricCatalog } from '@riviamigo/hooks';
import { getAllWidgets, getWidget } from './registry';
import { WidgetHost } from './WidgetHost';
import type { DashboardConfig, WidgetInstance } from './schema';
import type { WidgetCtx } from './registry';
import { getChartDefinitions, type DashboardChartPage } from './charts/catalog';

/** Pixels per row unit — must match DashboardRenderer. */
const ROW_HEIGHT = 80;
const COLS = 12;

interface GridEditorProps {
  config: DashboardConfig;
  ctx: WidgetCtx;
  onConfigChange: ((next: DashboardConfig) => void) | undefined;
}

function layoutFromConfig(widgets: WidgetInstance[]): LayoutItem[] {
  return widgets.map((w) => ({
    i: w.id,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: getWidget(w.widgetId)?.minSize.w ?? 1,
    minH: getWidget(w.widgetId)?.minSize.h ?? 1,
  }));
}

function applyLayout(widgets: WidgetInstance[], layout: readonly LayoutItem[]): WidgetInstance[] {
  const map = new Map(layout.map((l) => [l.i, l]));
  return widgets.map((w) => {
    const l = map.get(w.id);
    if (!l) return w;
    return { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
  });
}

/** Distribute selected widgets evenly across 12 columns on the same row. */
function fillHorizontal(widgets: WidgetInstance[], selectedIds: Set<string>): WidgetInstance[] {
  const selected = widgets.filter((w) => selectedIds.has(w.id));
  const rows = new Set(selected.map((w) => w.layout.y));
  if (rows.size !== 1) return widgets;

  const count = selected.length;
  const per = Math.floor(COLS / count);
  const remainder = COLS - per * count;
  const sorted = [...selected].sort((a, b) => a.layout.x - b.layout.x);

  let cursor = 0;
  const updated = sorted.map((w, i) => {
    const width = i < remainder ? per + 1 : per;
    const next = { ...w, layout: { ...w.layout, x: cursor, w: width } };
    cursor += width;
    return next;
  });

  const updatedMap = new Map(updated.map((w) => [w.id, w]));
  return widgets.map((w) => updatedMap.get(w.id) ?? w);
}

export default function GridEditor({ config, ctx, onConfigChange }: GridEditorProps) {
  const configWidgets = Array.isArray(config.widgets) ? config.widgets : [];
  const [widgets, setWidgets] = useState<WidgetInstance[]>(configWidgets);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const update = useCallback(
    (next: WidgetInstance[]) => {
      setWidgets(next);
      setDirty(true);
      onConfigChange?.({ ...config, widgets: next });
    },
    [config, onConfigChange],
  );

  function handleLayoutChange(layout: readonly LayoutItem[]) {
    update(applyLayout(widgets, layout));
  }

  function removeWidget(id: string) {
    update(widgets.filter((w) => w.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function addWidget(widgetId: string) {
    const def = getWidget(widgetId);
    if (!def) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
    const instance: WidgetInstance = {
      id: uuidv4(),
      widgetId,
      title: def.title,
      layout: { x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h },
      options: def.defaultOptions,
    };
    update([...widgets, instance]);
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    if (!e.shiftKey) {
      setSelected(new Set([id]));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleFillHorizontal() {
    if (selected.size < 2) return;
    update(fillHorizontal(widgets, selected));
  }

  function handleReset() {
    setWidgets(configWidgets);
    setSelected(new Set());
    setDirty(false);
    onConfigChange?.({ ...config, widgets: configWidgets });
  }

  const allWidgets = getAllWidgets().filter(
    (def) => !def.id.startsWith('custom.') || def.id === 'custom.overview_vehicle',
  );
  const editingWidget = editingId ? widgets.find((w) => w.id === editingId) ?? null : null;
  const filteredWidgets = search.trim()
    ? allWidgets.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.category.toLowerCase().includes(search.toLowerCase()),
      )
    : allWidgets;

  const multiRowSelection =
    selected.size >= 2 &&
    new Set(widgets.filter((w) => selected.has(w.id)).map((w) => w.layout.y)).size > 1;

  return (
    <>
      {/* Fix resize handle z-index and placeholder colour */}
      <style>{`
        .rgl-editor .react-grid-placeholder {
          background: #6366f1 !important;
          opacity: 0.2;
          border-radius: 8px;
        }
        .rgl-editor .react-resizable-handle {
          z-index: 30;
          width: 26px;
          height: 26px;
          right: 2px;
          bottom: 2px;
          border-radius: 8px 0 8px 0;
          background: color-mix(in oklab, var(--rm-accent) 18%, transparent);
        }
        .rgl-editor .react-resizable-handle::after {
          right: 8px;
          bottom: 8px;
          width: 8px;
          height: 8px;
          border-color: rgba(99,102,241,0.7);
        }
      `}</style>

      <div className="rgl-editor flex gap-4">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={handleFillHorizontal}
              disabled={selected.size < 2 || multiRowSelection}
              title={multiRowSelection ? 'Select widgets on the same row' : 'Fill horizontal'}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors disabled:cursor-not-allowed"
            >
              <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
              Fill Row
            </button>
            <span className="text-xs text-fg-tertiary">
              Drag to move, resize from the corner, or use the sliders to edit
            </span>
            <button
              onClick={handleReset}
              disabled={!dirty}
              title="Reset to saved layout"
              className="ml-auto p-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div ref={containerRef as React.Ref<HTMLDivElement>} className="w-full">
            {mounted && (
              <GridLayout
                layout={layoutFromConfig(widgets)}
                width={width}
                gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [16, 16] as readonly [number, number], containerPadding: [0, 0] as readonly [number, number], maxRows: Infinity }}
                dragConfig={{ enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
                resizeConfig={{ enabled: true, handles: ['se'] }}
                onLayoutChange={handleLayoutChange}
                className="bg-bg-elevated/30 rounded-xl border border-dashed border-border"
              >
                {widgets.map((w) => (
                  <div
                    key={w.id}
                    onClick={(e) => toggleSelect(w.id, e)}
                    className={`group relative rounded-lg border transition-colors cursor-pointer ${
                      selected.has(w.id) ? 'border-accent ring-1 ring-accent/30' : 'border-border'
                    } bg-bg`}
                  >
                    {/* Delete — top-left, hover-only */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }}
                      title="Remove widget"
                      className="absolute left-1.5 top-1.5 z-10 rounded-md p-1 opacity-75 transition text-fg-tertiary hover:bg-black/20 hover:text-red-400 group-hover:opacity-100"
                    >
                      <X className="h-4 w-4" />
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(w.id); }}
                      title="Edit widget"
                      className="absolute left-9 top-1.5 z-10 rounded-md p-1 opacity-75 transition text-fg-tertiary hover:bg-black/20 hover:text-fg group-hover:opacity-100"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>

                    {/* Drag handle — top-right, hover-only */}
                    <div
                      className="drag-handle absolute right-1.5 top-1.5 z-10 cursor-grab rounded-md p-1 opacity-75 transition text-fg-tertiary hover:bg-black/20 hover:text-fg active:cursor-grabbing group-hover:opacity-100"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>

                    <div className="h-full overflow-hidden p-2 pt-7 [&>*]:h-full">
                      <WidgetHost instance={w} ctx={ctx} />
                    </div>
                  </div>
                ))}
              </GridLayout>
            )}
          </div>
        </div>

        {/* Widget Palette — sticky, scrollable */}
        <aside className="w-56 shrink-0 sticky top-4 flex flex-col gap-2" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider shrink-0">
            Add Widget
          </p>

          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-tertiary pointer-events-none" />
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs pl-7 pr-3 py-1.5 rounded-lg border border-border bg-bg focus:outline-none focus:ring-1 focus:ring-accent/50 placeholder:text-fg-tertiary"
            />
          </div>

          {/* Scrollable list */}
          <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
            {filteredWidgets.map((def) => (
              <button
                key={def.id}
                onClick={() => addWidget(def.id)}
                className="flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
              >
                <Plus className="h-3 w-3 shrink-0 text-fg-tertiary" />
                <span className="truncate">{def.title}</span>
                <span className="ml-auto shrink-0 text-fg-tertiary capitalize">{def.category}</span>
              </button>
            ))}
            {filteredWidgets.length === 0 && (
              <p className="text-xs text-fg-tertiary px-3 py-2">No widgets found</p>
            )}
          </div>
        </aside>
      </div>
      {editingWidget ? (
        <WidgetEditModal
          widget={editingWidget}
          onClose={() => setEditingId(null)}
          onSave={(next) => {
            update(widgets.map((w) => (w.id === next.id ? next : w)));
            setEditingId(null);
          }}
        />
      ) : null}
    </>
  );
}

function WidgetEditModal({
  widget,
  onClose,
  onSave,
}: {
  widget: WidgetInstance;
  onClose: () => void;
  onSave: (next: WidgetInstance) => void;
}) {
  const def = getWidget(widget.widgetId);
  const { data: catalog = [] } = useMetricCatalog();
  const [title, setTitle] = useState(widget.title ?? def?.title ?? '');
  const [optionsText, setOptionsText] = useState(() => JSON.stringify(widget.options ?? def?.defaultOptions ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const parsedOptions = React.useMemo(() => {
    try {
      return JSON.parse(optionsText || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [optionsText]);

  function patchOptions(patch: Record<string, unknown>) {
    const next = { ...parsedOptions, ...patch };
    setOptionsText(JSON.stringify(next, null, 2));
    setJsonError(null);
  }

  function patchOption(key: string, value: unknown) {
    patchOptions({ [key]: value });
  }

  function handleSave() {
    try {
      const options = JSON.parse(optionsText || '{}') as Record<string, unknown>;
      onSave({ ...widget, title: title.trim() || undefined, options });
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }

  const metricMode = def?.editMode === 'metric';
  const chartMode = def?.editMode === 'chart';
  const metric = typeof parsedOptions.metric === 'string' ? parsedOptions.metric : 'total_miles';
  const chartType = typeof parsedOptions.chartType === 'string' ? parsedOptions.chartType : 'line';
  const valueSize = typeof parsedOptions.valueSize === 'string' ? parsedOptions.valueSize : 'md';
  const chartPage = isDashboardChartPage(parsedOptions.page) ? parsedOptions.page : undefined;
  const chartDefinitions = getChartDefinitions(chartPage);
  const configuredChartIds = Array.isArray(parsedOptions.chartIds)
    ? parsedOptions.chartIds.filter((id): id is string => typeof id === 'string' && chartDefinitions.some((definition) => definition.id === id))
    : [];
  const selectedChartIds = configuredChartIds.length > 0 ? configuredChartIds : chartDefinitions.map((definition) => definition.id);
  const selectedChartIdSet = new Set(selectedChartIds);
  const selectedChartId = typeof parsedOptions.chartId === 'string' && selectedChartIdSet.has(parsedOptions.chartId)
    ? parsedOptions.chartId
    : selectedChartIds[0] ?? chartDefinitions[0]?.id ?? '';
  const showPicker = parsedOptions.showPicker !== false;

  function toggleChartDefinition(id: string) {
    const nextIds = selectedChartIdSet.has(id)
      ? selectedChartIds.filter((chartId) => chartId !== id)
      : [...selectedChartIds, id];
    const safeIds = nextIds.length > 0 ? nextIds : [id];
    patchOptions({
      chartIds: safeIds,
      chartId: safeIds.includes(selectedChartId) ? selectedChartId : safeIds[0],
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-bg p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Edit Widget</h2>
            <p className="text-xs text-fg-tertiary">{def?.title ?? widget.widgetId}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-fg-tertiary hover:bg-bg-elevated hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-fg-secondary">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>

          {metricMode ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                Sensor
                <select
                  value={metric}
                  onChange={(e) => patchOption('metric', e.target.value)}
                  className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                >
                  {catalog.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                Background Chart
                <select
                  value={chartType}
                  onChange={(e) => patchOption('chartType', e.target.value)}
                  className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="none">None</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                  <option value="bar">Bar</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                Subtitle
                <input
                  value={typeof parsedOptions.subtitle === 'string' ? parsedOptions.subtitle : ''}
                  onChange={(e) => patchOption('subtitle', e.target.value)}
                  className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                Value Size
                <select
                  value={valueSize}
                  onChange={(e) => patchOption('valueSize', e.target.value)}
                  className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </label>
            </div>
          ) : null}

          {chartMode ? (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                  Chart Group
                  <select
                    value={chartPage ?? ''}
                    onChange={(e) => patchOptions({ page: e.target.value || undefined, chartIds: undefined })}
                    className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  >
                    <option value="">All charts</option>
                    <option value="overview">Overview</option>
                    <option value="battery">Battery</option>
                    <option value="charging">Charging</option>
                    <option value="efficiency">Efficiency</option>
                    <option value="trips">Trips</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-medium text-fg-secondary">
                  Default Chart
                  <select
                    value={selectedChartId}
                    onChange={(e) => patchOption('chartId', e.target.value)}
                    className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  >
                    {chartDefinitions.map((definition) => (
                      <option key={definition.id} value={definition.id}>{definition.title}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs font-medium text-fg-secondary">
                <input
                  type="checkbox"
                  checked={showPicker}
                  onChange={(e) => patchOption('showPicker', e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--rm-accent)]"
                />
                Show chart dropdown inside this widget
              </label>

              <div className="grid gap-2 rounded-lg border border-border bg-bg-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-fg-secondary">Charts available in this widget</span>
                  <span className="text-[11px] text-fg-tertiary">{selectedChartIds.length} selected</span>
                </div>
                <div className="grid max-h-48 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {chartDefinitions.map((definition) => (
                    <label key={definition.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs text-fg-secondary hover:bg-bg-elevated">
                      <input
                        type="checkbox"
                        checked={selectedChartIdSet.has(definition.id)}
                        onChange={() => toggleChartDefinition(definition.id)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--rm-accent)]"
                      />
                      <span className="grid gap-0.5">
                        <span className="font-medium text-fg">{definition.title}</span>
                        {definition.description ? <span className="text-[11px] text-fg-tertiary">{definition.description}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <label className="grid gap-1 text-xs font-medium text-fg-secondary">
            Options JSON
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              rows={metricMode ? 7 : chartMode ? 6 : 12}
              spellCheck={false}
              className="rounded-lg border border-border bg-bg-surface px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
            />
          </label>
          {jsonError ? <p className="text-xs text-red-400">{jsonError}</p> : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs text-fg-secondary hover:bg-bg-elevated">
            Cancel
          </button>
          <button type="button" onClick={handleSave} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:brightness-110">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function isDashboardChartPage(value: unknown): value is DashboardChartPage {
  return value === 'overview' || value === 'battery' || value === 'charging' || value === 'efficiency' || value === 'trips';
}
