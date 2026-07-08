import React from 'react';
import { GripVertical, Lock, Pencil } from 'lucide-react';
import { WidgetHost } from './WidgetHost';
import type { WidgetCtx, WidgetEditorMeta } from './registry';
import type { WidgetInstance } from './schema';

export interface WidgetChromeProps extends React.HTMLAttributes<HTMLDivElement> {
  instance: WidgetInstance;
  ctx: WidgetCtx;
  mode: 'view' | 'edit';
  editor?: WidgetEditorMeta;
  isEditing?: boolean;
  onToggleEdit?: () => void;
  updateWidgetOptions?: (widgetId: string, patch: Record<string, unknown>) => void;
}

export const WidgetChrome = React.forwardRef<HTMLDivElement, WidgetChromeProps>(function WidgetChrome({
  instance,
  ctx,
  mode,
  editor,
  isEditing = false,
  onToggleEdit,
  updateWidgetOptions,
  className,
  style,
  children,
  ...frameProps
}, ref) {
  const hostCtx = updateWidgetOptions ? { ...ctx, updateWidgetOptions } : ctx;

  if (mode === 'view') {
    return (
      <div
        {...frameProps}
        ref={ref}
        className={['dashboard-widget-frame h-full min-h-0', className].filter(Boolean).join(' ')}
        style={style}
        data-widget-frame="view"
      >
        <WidgetHost instance={instance} ctx={hostCtx} />
        {children}
      </div>
    );
  }

  const movable = editor?.movable ?? true;
  const fixedSize = editor?.fixedSize ?? false;

  return (
    <div
      {...frameProps}
      ref={ref}
      data-widget-frame="edit"
      data-widget-id={instance.id}
      data-widget-type={instance.componentType}
      data-widget-definition={instance.definitionId}
      data-editing={isEditing ? 'true' : 'false'}
      data-fixed-size={fixedSize ? 'true' : 'false'}
      className={[
        className,
        'rgl-card relative overflow-hidden rounded-lg border bg-bg transition-all',
        isEditing
          ? 'border-status-positive shadow-[0_0_0_2px_color-mix(in_oklab,var(--rm-status-positive)_28%,transparent)]'
          : 'border-border hover:border-border-strong',
      ].filter(Boolean).join(' ')}
      style={style}
    >
      <div className="h-full w-full p-2">
        <WidgetHost instance={instance} ctx={hostCtx} />
      </div>

      <DashboardEditOverlay
        instance={instance}
        movable={movable}
        fixedSize={fixedSize}
        isEditing={isEditing}
        {...(onToggleEdit ? { onToggleEdit } : {})}
      />

      {isEditing ? (
        <div className="pointer-events-none absolute inset-0 z-30 rounded-lg ring-2 ring-status-positive/40" />
      ) : null}

      {children}
    </div>
  );
});

function DashboardEditOverlay({
  instance,
  movable,
  fixedSize,
  isEditing,
  onToggleEdit,
}: {
  instance: WidgetInstance;
  movable: boolean;
  fixedSize: boolean;
  isEditing: boolean;
  onToggleEdit?: () => void;
}) {
  return (
    <>
      <div
        data-testid={`widget-overlay-left-${instance.id}`}
        className="rgl-widget-overlay absolute left-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 p-1 shadow-lg backdrop-blur transition-opacity duration-150"
      >
        {movable ? (
          <button
            type="button"
            className="drag-handle rgl-action cursor-grab rounded-md active:cursor-grabbing"
            title="Drag to move"
            aria-label="Drag to move"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {fixedSize ? (
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
        data-testid={`widget-overlay-right-${instance.id}`}
        className="rgl-widget-overlay absolute right-2 top-2 z-40 flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 p-1 shadow-lg backdrop-blur transition-opacity duration-150"
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleEdit?.();
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
    </>
  );
}
