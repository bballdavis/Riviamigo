import React, { useState, useCallback } from 'react';
import GridLayout from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { v4 as uuidv4 } from 'uuid';
import { X, GripVertical, Plus, AlignHorizontalDistributeCenter } from 'lucide-react';
import { getAllWidgets, getWidget } from './registry';
import { WidgetHost } from './WidgetHost';
import type { DashboardConfig, WidgetInstance } from './schema';
import type { WidgetCtx } from './registry';

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
  if (rows.size !== 1) return widgets; // multi-row selection — no-op

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
  const [widgets, setWidgets] = useState<WidgetInstance[]>(config.widgets);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

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
      layout: { x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h },
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

  function handleSave() {
    onConfigChange?.({ ...config, widgets });
    setDirty(false);
  }

  function handleReset() {
    setWidgets(config.widgets);
    setSelected(new Set());
    setDirty(false);
  }

  const allWidgets = getAllWidgets();
  const multiRowSelection =
    selected.size >= 2 &&
    new Set(widgets.filter((w) => selected.has(w.id)).map((w) => w.layout.y)).size > 1;

  return (
    <div className="flex gap-4">
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
            Fill Horizontal
          </button>
          <span className="text-xs text-fg-tertiary">
            {selected.size > 0
              ? `${selected.size} selected`
              : 'Click to select · Shift+click for multi'}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleReset}
              disabled={!dirty}
              className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/90 transition-colors"
            >
              Save
            </button>
          </div>
        </div>

        <GridLayout
          layout={layoutFromConfig(widgets)}
          width={1200}
          gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [16, 16] as readonly [number, number], containerPadding: null, maxRows: Infinity }}
          dragConfig={{ enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
          onLayoutChange={handleLayoutChange}
          className="bg-bg-elevated/30 rounded-xl border border-dashed border-border"
        >
          {widgets.map((w) => (
            <div
              key={w.id}
              onClick={(e) => toggleSelect(w.id, e)}
              className={`relative rounded-lg border transition-colors cursor-pointer ${
                selected.has(w.id) ? 'border-accent ring-1 ring-accent/30' : 'border-border'
              } bg-bg overflow-hidden`}
            >
              {/* Drag handle */}
              <div className="drag-handle absolute top-1.5 left-1.5 z-10 cursor-grab text-fg-tertiary hover:text-fg transition-colors">
                <GripVertical className="h-3.5 w-3.5" />
              </div>
              {/* Remove */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeWidget(w.id);
                }}
                className="absolute top-1.5 right-1.5 z-10 text-fg-tertiary hover:text-fg transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="p-2 h-full">
                <WidgetHost instance={w} ctx={ctx} />
              </div>
            </div>
          ))}
        </GridLayout>
      </div>

      {/* Widget Palette */}
      <aside className="w-56 shrink-0">
        <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2">
          Add Widget
        </p>
        <div className="flex flex-col gap-1">
          {allWidgets.map((def) => (
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
        </div>
      </aside>
    </div>
  );
}
