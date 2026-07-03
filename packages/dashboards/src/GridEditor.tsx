import React, { useCallback, useState } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { v4 as uuidv4 } from 'uuid';
import { GripVertical, Lock, Pencil } from 'lucide-react';
import { getAllWidgets, getWidgetEditorMeta, getWidgetForInstance } from './registry';
import { sanitizeWidgetInstance, sanitizeWidgetLayout } from './layout';
import { WidgetHost } from './WidgetHost';
import type { DashboardConfig, WidgetInstance } from './schema';
import type { WidgetCtx, WidgetDef } from './registry';
import { EditorDrawer } from './editor/EditorDrawer';
import { PaletteView } from './editor/PaletteView';
import { WidgetEditForm } from './editor/WidgetEditForm';

const ROW_HEIGHT = 40;
const COLS = 12;

interface GridEditorProps {
  config: DashboardConfig;
  ctx: WidgetCtx;
  onConfigChange: ((next: DashboardConfig) => void) | undefined;
  editActions?: React.ReactNode;
}

function layoutFromConfig(widgets: WidgetInstance[]): LayoutItem[] {
  return widgets.map(layoutItemForWidget);
}

function layoutItemForWidget(widget: WidgetInstance): LayoutItem {
  const def = getWidgetForInstance(widget);
  const editor = getWidgetEditorMeta(def);
  const minSize = editor.fixedSize ? widget.layout : def?.minSize ?? { w: 1, h: 1 };
  const maxSize = editor.fixedSize ? widget.layout : editor.maxSize;
  const item: LayoutItem = {
    i: widget.id,
    x: widget.layout.x,
    y: widget.layout.y,
    w: widget.layout.w,
    h: widget.layout.h,
    minW: minSize.w,
    minH: minSize.h,
    isDraggable: editor.movable,
    isResizable: editor.resizable,
  };

  if (maxSize) {
    item.maxW = maxSize.w;
    item.maxH = maxSize.h;
  }

  return item;
}

function applyLayout(widgets: WidgetInstance[], layout: readonly LayoutItem[]): WidgetInstance[] {
  const map = new Map(layout.map((item) => [item.i, item]));
  return widgets.map((widget) => {
    const item = map.get(widget.id);
    if (!item) return widget;

    const next = sanitizeWidgetInstance({
      ...widget,
      layout: sanitizeWidgetLayout({ x: item.x, y: item.y, w: item.w, h: item.h }),
    });

    return layoutsEqual(next.layout, widget.layout) ? widget : next;
  });
}

function layoutsEqual(a: WidgetInstance['layout'], b: WidgetInstance['layout']) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export default function GridEditor({ config, ctx, onConfigChange, editActions }: GridEditorProps) {
  const widgets = Array.isArray(config.widgets) ? config.widgets.map(sanitizeWidgetInstance) : [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const commit = useCallback(
    (next: WidgetInstance[]) => {
      onConfigChange?.({ ...config, widgets: next.map(sanitizeWidgetInstance) });
    },
    [config, onConfigChange],
  );

  function handleLayoutChange(layout: readonly LayoutItem[]) {
    const next = applyLayout(widgets, layout);
    if (next !== widgets) commit(next);
  }

  function removeWidget(id: string) {
    commit(widgets.filter((widget) => widget.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addWidget(def: WidgetDef) {
    const maxY = widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
    const instance: WidgetInstance = sanitizeWidgetInstance({
      id: uuidv4(),
      componentType: def.componentType,
      definitionId: def.definitionId,
      title: def.title,
      layout: { x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h },
      options: def.defaultOptions,
    });
    commit([...widgets, instance]);
  }

  function updateWidget(next: WidgetInstance) {
    const sanitized = sanitizeWidgetInstance(next);
    commit(widgets.map((widget) => (widget.id === sanitized.id ? sanitized : widget)));
  }

  function patchWidgetOptions(widgetId: string, patch: Record<string, unknown>) {
    const widget = widgets.find((entry) => entry.id === widgetId);
    if (!widget) return;
    updateWidget({
      ...widget,
      options: {
        ...(widget.options ?? {}),
        ...patch,
      },
    });
  }

  const editingWidget = editingId ? widgets.find((widget) => widget.id === editingId) ?? null : null;
  const drawerMode: 'palette' | 'edit' = editingWidget ? 'edit' : 'palette';

  return (
    <>
      <style>{`
        .rgl-editor .react-grid-placeholder {
          background: color-mix(in oklab, var(--rm-accent) 48%, transparent) !important;
          border: 1px solid color-mix(in oklab, var(--rm-accent) 75%, transparent);
          border-radius: 8px;
          opacity: 0.18;
        }
        .rgl-editor .react-resizable-handle {
          z-index: 42;
          opacity: 0;
          pointer-events: none;
          background-image: none;
          transition: opacity 120ms ease;
        }
        .rgl-editor .react-grid-item:hover .react-resizable-handle,
        .rgl-editor .react-grid-item.resizing .react-resizable-handle,
        .rgl-editor .react-grid-item.react-draggable-dragging .react-resizable-handle {
          opacity: 1;
          pointer-events: auto;
        }
        .rgl-editor .rgl-widget-overlay {
          opacity: 0;
          pointer-events: none;
        }
        .rgl-editor .react-grid-item:hover .rgl-widget-overlay,
        .rgl-editor .react-grid-item:focus-within .rgl-widget-overlay,
        .rgl-editor .react-grid-item.resizing .rgl-widget-overlay,
        .rgl-editor .react-grid-item.react-draggable-dragging .rgl-widget-overlay,
        .rgl-editor .react-grid-item:has(.rgl-card[data-editing="true"]) .rgl-widget-overlay {
          opacity: 1;
          pointer-events: auto;
        }
        .rgl-editor .react-grid-item:has(.rgl-card[data-fixed-size="true"]) .react-resizable-handle {
          display: none;
        }
        .rgl-editor .react-resizable-handle-se {
          right: 0;
          bottom: 0;
          width: 28px;
          height: 28px;
          border: 1px solid color-mix(in oklab, var(--rm-accent) 70%, transparent);
          border-radius: 10px 0 8px 0;
          background: var(--rm-bg-elevated);
          cursor: se-resize;
        }
        .rgl-editor .react-resizable-handle-se::after {
          content: '';
          position: absolute;
          right: 6px;
          bottom: 6px;
          width: 8px;
          height: 8px;
          border-right: 2px solid var(--rm-accent);
          border-bottom: 2px solid var(--rm-accent);
        }
        .rgl-editor .rgl-action {
          height: 1.75rem;
          width: 1.75rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--rm-border-default);
          background: color-mix(in oklab, var(--rm-bg-elevated) 92%, transparent);
          color: var(--rm-text-secondary);
          backdrop-filter: blur(10px);
        }
        .rgl-editor .rgl-action:hover {
          color: var(--rm-text-primary);
          border-color: var(--rm-border-strong);
        }
      `}</style>

      <div className="rgl-editor min-w-0">
        <div ref={containerRef as React.Ref<HTMLDivElement>} className="w-full min-w-0">
          {mounted ? (
            <GridLayout
              layout={layoutFromConfig(widgets)}
              width={width}
              gridConfig={{
                cols: COLS,
                rowHeight: ROW_HEIGHT,
                margin: [16, 16] as readonly [number, number],
                containerPadding: [0, 0] as readonly [number, number],
                maxRows: Infinity,
              }}
              dragConfig={{ enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              onLayoutChange={handleLayoutChange}
              className="rounded-xl border border-dashed border-border bg-bg-elevated/30"
            >
              {widgets.map((widget) => {
                const isEditing = editingId === widget.id;
                const def = getWidgetForInstance(widget);
                const editor = getWidgetEditorMeta(def);
                return (
                  <div
                    key={widget.id}
                    data-editing={isEditing ? 'true' : 'false'}
                    data-fixed-size={editor.fixedSize ? 'true' : 'false'}
                    className={[
                      'rgl-card relative overflow-hidden rounded-lg border bg-bg transition-all',
                      isEditing
                        ? 'border-status-positive shadow-[0_0_0_2px_color-mix(in_oklab,var(--rm-status-positive)_28%,transparent)]'
                        : 'border-border hover:border-border-strong',
                    ].join(' ')}
                  >
                    <div className="h-full w-full p-2">
                      <WidgetHost instance={widget} ctx={{ ...ctx, updateWidgetOptions: patchWidgetOptions }} />
                    </div>

                    <div
                      data-testid={`widget-overlay-left-${widget.id}`}
                      className={[
                        'rgl-widget-overlay absolute left-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 p-1 shadow-lg backdrop-blur transition-opacity duration-150',
                      ].join(' ')}
                    >
                      {editor.movable ? (
                        <button
                          type="button"
                          className="drag-handle rgl-action cursor-grab rounded-md active:cursor-grabbing"
                          title="Drag to move"
                          aria-label="Drag to move"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {editor.fixedSize ? (
                        <span
                          className="rgl-action rounded-md"
                          title="Fixed-size widget"
                          aria-label="Fixed-size widget"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </div>

                    <div
                      data-testid={`widget-overlay-right-${widget.id}`}
                      className={[
                        'rgl-widget-overlay absolute right-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 p-1 shadow-lg backdrop-blur transition-opacity duration-150',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingId(isEditing ? null : widget.id);
                        }}
                        title={isEditing ? 'Close editor' : 'Edit widget settings'}
                        aria-label={isEditing ? 'Close editor' : 'Edit widget settings'}
                        className={[
                          'rgl-action rounded-md',
                          isEditing ? 'border-status-positive/60 text-status-positive' : '',
                        ].join(' ')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {isEditing ? (
                      <div className="pointer-events-none absolute inset-0 z-30 rounded-lg ring-2 ring-status-positive/40" />
                    ) : null}
                  </div>
                );
              })}
            </GridLayout>
          ) : null}
        </div>
      </div>

      <EditorDrawer
        mode={drawerMode}
        onBackToPalette={() => setEditingId(null)}
        editActions={editActions}
        paletteContent={<PaletteView widgets={getAllWidgets()} onAdd={addWidget} />}
        editContent={
          editingWidget ? (
            <WidgetEditForm
              widget={editingWidget}
              onChange={updateWidget}
              onClose={() => setEditingId(null)}
              onRemove={() => removeWidget(editingWidget.id)}
            />
          ) : null
        }
      />
    </>
  );
}
