import React, { useCallback, useState } from 'react';
import GridLayout, { useContainerWidth } from 'react-grid-layout';
import type { LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { v4 as uuidv4 } from 'uuid';
import { X, GripVertical, Pencil } from 'lucide-react';
import { getAllWidgets, getWidgetForInstance } from './registry';
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
  return widgets.map((w) => ({
    i: w.id,
    x: w.layout.x,
    y: w.layout.y,
    w: w.layout.w,
    h: w.layout.h,
    minW: getWidgetForInstance(w)?.minSize.w ?? 1,
    minH: getWidgetForInstance(w)?.minSize.h ?? 1,
  }));
}

function applyLayout(widgets: WidgetInstance[], layout: readonly LayoutItem[]): WidgetInstance[] {
  const map = new Map(layout.map((l) => [l.i, l]));
  return widgets.map((w) => {
    const l = map.get(w.id);
    if (!l) return w;
    if (l.x === w.layout.x && l.y === w.layout.y && l.w === w.layout.w && l.h === w.layout.h) {
      return w;
    }
    return { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
  });
}

export default function GridEditor({ config, ctx, onConfigChange, editActions }: GridEditorProps) {
  const widgets = Array.isArray(config.widgets) ? config.widgets : [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const commit = useCallback(
    (next: WidgetInstance[]) => {
      onConfigChange?.({ ...config, widgets: next });
    },
    [config, onConfigChange]
  );

  function handleLayoutChange(layout: readonly LayoutItem[]) {
    const next = applyLayout(widgets, layout);
    if (next !== widgets) commit(next);
  }

  function removeWidget(id: string) {
    commit(widgets.filter((w) => w.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function addWidget(def: WidgetDef) {
    const maxY = widgets.reduce((m, w) => Math.max(m, w.layout.y + w.layout.h), 0);
    const instance: WidgetInstance = {
      id: uuidv4(),
      componentType: def.componentType,
      definitionId: def.definitionId,
      title: def.title,
      layout: { x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h },
      options: def.defaultOptions,
    };
    commit([...widgets, instance]);
  }

  function updateWidget(next: WidgetInstance) {
    commit(widgets.map((w) => (w.id === next.id ? next : w)));
  }

  const editingWidget = editingId ? widgets.find((w) => w.id === editingId) ?? null : null;
  const drawerMode: 'palette' | 'edit' = editingWidget ? 'edit' : 'palette';

  return (
    <>
      <style>{`
        /* Placeholder during drag */
        .rgl-editor .react-grid-placeholder {
          background: #6366f1 !important;
          opacity: 0.2;
          border-radius: 8px;
        }

        /* Resize handle — always hidden until hovered */
        .rgl-editor .react-resizable-handle {
          z-index: 40;
          opacity: 0;
          background-image: none;
          transition: opacity 120ms ease;
          pointer-events: none;
        }
        .rgl-editor .react-grid-item:hover .react-resizable-handle,
        .rgl-editor .react-grid-item.react-draggable-dragging .react-resizable-handle,
        .rgl-editor .react-grid-item.resizing .react-resizable-handle {
          opacity: 1;
          pointer-events: auto;
        }
        /* SE resize handle — flush with card corner, notched inner corner */
        .rgl-editor .react-resizable-handle-se {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 26px;
          height: 26px;
          /* TL = inward notch, rest flush/clipped by card overflow:hidden */
          border-radius: 10px 0 8px 0;
          border: 1px solid color-mix(in oklab, var(--rm-accent) 65%, transparent);
          background: #1a1a1a;
          box-shadow: none;
          cursor: se-resize;
        }
        .rgl-editor .react-resizable-handle-se::after {
          content: '';
          position: absolute;
          right: 5px;
          bottom: 5px;
          width: 8px;
          height: 8px;
          border-right: 2px solid var(--rm-accent);
          border-bottom: 2px solid var(--rm-accent);
        }

        /* All three overlay buttons — hidden by default, shown on grid-item hover */
        .rgl-editor .rgl-overlay {
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        .rgl-editor .react-grid-item:hover .rgl-overlay {
          opacity: 1;
          pointer-events: auto;
        }
        /* Keep visible when the card is in 'editing' state */
        .rgl-editor .rgl-card[data-editing="true"] .rgl-overlay {
          opacity: 1;
          pointer-events: auto;
        }
        /* Delete button hover state */
        .rgl-editor button.rgl-delete:hover {
          background-color: #1a1a1a !important;
          border-color: rgba(248, 113, 113, 0.7) !important;
          color: rgb(248, 113, 113) !important;
        }
      `}</style>

      <div className="rgl-editor">
        <div ref={containerRef as React.Ref<HTMLDivElement>} className="w-full">
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
              {widgets.map((w) => {
                const isEditing = editingId === w.id;
                return (
                  <div
                    key={w.id}
                    data-editing={isEditing ? 'true' : 'false'}
                    className={`rgl-card relative overflow-hidden rounded-lg border bg-bg transition-all ${
                      isEditing
                        ? 'border-accent shadow-[0_0_0_2px_color-mix(in_oklab,var(--rm-accent)_28%,transparent)]'
                        : 'border-border'
                    }`}
                  >
                    {/* Widget content */}
                    <div className="h-full w-full p-2">
                      <WidgetHost instance={w} ctx={ctx} />
                    </div>

                    {/* Move handle — NW corner, inner notch at BR */}
                    <div
                      className="drag-handle rgl-overlay absolute left-0 top-0 z-40 flex h-7 w-7 cursor-grab items-center justify-center border border-accent/60 text-accent active:cursor-grabbing"
                      style={{ borderRadius: '0 0 10px 0', backgroundColor: '#1a1a1a' }}
                      title="Drag to move"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>

                    {/* Delete — NE corner, inner notch at BL */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }}
                      title="Remove widget"
                      className="rgl-overlay rgl-delete absolute right-0 top-0 z-40 flex h-7 w-7 items-center justify-center border border-accent/60 text-accent transition-colors"
                      style={{ borderRadius: '0 0 0 10px', backgroundColor: '#1a1a1a' }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>

                    {/* Edit — center */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(isEditing ? null : w.id);
                      }}
                      title={isEditing ? 'Close editor' : 'Edit widget settings'}
                      className={`rgl-overlay absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                        isEditing
                          ? 'border-accent text-accent'
                          : 'border-accent/60 text-accent'
                      }`}
                      style={{ backgroundColor: isEditing ? 'rgba(var(--rm-accent-rgb, 251 146 60) / 0.2)' : '#1a1a1a' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {isEditing ? 'Editing' : 'Edit'}
                    </button>
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
            />
          ) : null
        }
      />
    </>
  );
}
