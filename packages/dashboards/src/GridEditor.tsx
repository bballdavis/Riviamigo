import React, { useCallback, useEffect, useRef, useState } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { getAllWidgets, getWidgetEditorMeta, getWidgetForInstance } from './registry';
import { sanitizeWidgetInstance } from './layout';
import {
  applyWidgetLayout,
  createWidgetInstance,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_ROW_HEIGHT,
  dashboardKey,
} from './dashboardModel';
import { WidgetChrome } from './WidgetChrome';
import type { DashboardConfig, WidgetInstance } from './schema';
import type { WidgetCtx, WidgetDef } from './registry';
import type { DashboardVisibilityState } from './dashboardVisibility';
import {
  DEFAULT_DASHBOARD_VISIBILITY_STATE,
  getWidgetVisibilityRules,
} from './dashboardVisibility';
import { EditorDrawer } from './editor/EditorDrawer';
import { PaletteView } from './editor/PaletteView';
import { WidgetEditForm } from './editor/WidgetEditForm';

interface GridEditorProps {
  config: DashboardConfig;
  ctx: WidgetCtx;
  onConfigChange: ((next: DashboardConfig) => void) | undefined;
  editActions?: React.ReactNode;
  previewControls?: React.ReactNode;
  visibleWidgetIds?: string[];
  visibilityState?: DashboardVisibilityState;
  onVisibilityStateChange?: (
    type: 'vehicle-connection',
    value: DashboardVisibilityState['vehicle-connection'],
  ) => void;
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
    resizeHandles: editor.resizable ? ['se'] : [],
  };

  if (maxSize) {
    item.maxW = maxSize.w;
    item.maxH = maxSize.h;
  }

  return item;
}

export default function GridEditor({
  config,
  ctx,
  onConfigChange,
  editActions,
  previewControls,
  visibleWidgetIds: requestedVisibleWidgetIds,
  visibilityState = DEFAULT_DASHBOARD_VISIBILITY_STATE,
  onVisibilityStateChange = () => {},
}: GridEditorProps) {
  const widgets = Array.isArray(config.widgets) ? config.widgets.map(sanitizeWidgetInstance) : [];
  const visibleWidgetIds = requestedVisibleWidgetIds ?? widgets.map((widget) => widget.id);
  const visibleWidgetIdSet = new Set(visibleWidgetIds);
  const visibleWidgets = widgets.filter((widget) => visibleWidgetIdSet.has(widget.id));
  const [editingId, setEditingId] = useState<string | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();
  const currentDashboardKey = dashboardKey(config, config.slug);
  const previousDashboardKeyRef = useRef(currentDashboardKey);

  const commit = useCallback(
    (next: WidgetInstance[]) => {
      onConfigChange?.({ ...config, widgets: next.map(sanitizeWidgetInstance) });
    },
    [config, onConfigChange],
  );

  function handleLayoutChange(layout: readonly LayoutItem[]) {
    const next = applyWidgetLayout(widgets, layout);
    if (next !== widgets) commit(next);
  }

  function removeWidget(id: string) {
    commit(widgets.filter((widget) => widget.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addWidget(def: WidgetDef) {
    const maxY = widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
    const instance = createWidgetInstance(def, { x: 0, y: maxY });
    commit([...widgets, instance]);
  }

  function updateWidget(next: WidgetInstance) {
    const sanitized = sanitizeWidgetInstance(next);
    for (const rule of getWidgetVisibilityRules(sanitized)) {
      if (visibilityState[rule.type] !== rule.value) {
        onVisibilityStateChange(rule.type, rule.value);
      }
    }
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

  useEffect(() => {
    if (previousDashboardKeyRef.current !== currentDashboardKey) {
      previousDashboardKeyRef.current = currentDashboardKey;
      setEditingId(null);
      return;
    }

    if (editingId && !widgets.some((widget) => widget.id === editingId)) {
      setEditingId(null);
    }
  }, [currentDashboardKey, editingId, widgets]);

  useEffect(() => {
    if (editingId && !visibleWidgetIdSet.has(editingId)) setEditingId(null);
  }, [editingId, visibleWidgetIds.join('|')]);

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
          z-index: 60;
          opacity: 0.62;
          pointer-events: auto;
          background-image: none;
          transition: opacity 120ms ease, border-color 120ms ease;
        }
        .rgl-editor .react-grid-item:hover .react-resizable-handle,
        .rgl-editor .react-grid-item:focus-within .react-resizable-handle,
        .rgl-editor .react-grid-item.resizing .react-resizable-handle,
        .rgl-editor .react-grid-item.react-draggable-dragging .react-resizable-handle {
          opacity: 1;
        }
        .rgl-editor .rgl-widget-control {
          /* Keep editor controls functional even if a host app misses package Tailwind utilities. */
          position: absolute;
          top: 0.5rem;
          z-index: 200;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          opacity: 0.72;
          pointer-events: auto;
          transition: opacity 120ms ease;
        }
        .rgl-editor [data-widget-move-control="true"] {
          left: 0.5rem;
        }
        .rgl-editor [data-widget-edit-control="true"] {
          right: 0.5rem;
        }
        .rgl-editor .react-grid-item:hover .rgl-widget-control,
        .rgl-editor .react-grid-item:focus-within .rgl-widget-control,
        .rgl-editor .react-grid-item.resizing .rgl-widget-control,
        .rgl-editor .react-grid-item.react-draggable-dragging .rgl-widget-control,
        .rgl-editor .rgl-card[data-editing="true"] .rgl-widget-control {
          opacity: 1;
        }
        @media (hover: none), (pointer: coarse) {
          .rgl-editor .rgl-widget-control,
          .rgl-editor .react-resizable-handle {
            opacity: 1;
          }
          .rgl-editor .rgl-action {
            height: 2.25rem;
            width: 2.25rem;
          }
        }
        .rgl-editor .react-grid-item.react-resizable-hide .react-resizable-handle,
        .rgl-editor .rgl-card[data-widget-resizable="false"] .react-resizable-handle {
          display: none;
          pointer-events: none;
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
          height: 2rem;
          width: 2rem;
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
              layout={layoutFromConfig(visibleWidgets)}
              width={width}
              gridConfig={{
                cols: DASHBOARD_GRID_COLUMNS,
                rowHeight: DASHBOARD_ROW_HEIGHT,
                margin: [16, 16] as readonly [number, number],
                containerPadding: [0, 0] as readonly [number, number],
                maxRows: Infinity,
              }}
              dragConfig={{ enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              onLayoutChange={handleLayoutChange}
              className="rounded-xl border border-dashed border-border bg-bg-elevated/30"
            >
              {visibleWidgets.map((widget) => {
                const isEditing = editingId === widget.id;
                const def = getWidgetForInstance(widget);
                const editor = getWidgetEditorMeta(def);
                return (
                  <WidgetChrome
                    key={widget.id}
                    instance={widget}
                    ctx={ctx}
                    mode="edit"
                    editor={editor}
                    isEditing={isEditing}
                    onToggleEdit={() => setEditingId(isEditing ? null : widget.id)}
                    updateWidgetOptions={patchWidgetOptions}
                  />
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
        previewControls={previewControls}
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
