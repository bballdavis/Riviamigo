import React from 'react';
import { getWidget } from './registry';
import type { WidgetInstance, WidgetCtx } from './registry';

interface WidgetHostProps {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}

export function WidgetHost({ instance, ctx }: WidgetHostProps) {
  const def = getWidget(instance.widgetId);

  if (!def) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown widget: {instance.widgetId}
      </div>
    );
  }

  const Component = def.component;
  return (
    <div className="h-full">
      {instance.title && (
        <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2">
          {instance.title}
        </p>
      )}
      <Component instance={instance} ctx={ctx} />
    </div>
  );
}
