import React from 'react';
import { getWidgetForInstance } from './registry';
import type { WidgetInstance, WidgetCtx } from './registry';

interface WidgetHostProps {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}

export function WidgetHost({ instance, ctx }: WidgetHostProps) {
  const def = getWidgetForInstance(instance);

  if (!def) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown widget: {instance.componentType}/{instance.definitionId}
      </div>
    );
  }

  const Component = def.component;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {instance.title && shouldShowWidgetTitle(instance) ? (
        <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
          {instance.title}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 [&>*]:h-full">
        <Component instance={instance} ctx={ctx} />
      </div>
    </div>
  );
}

function shouldShowWidgetTitle(instance: WidgetInstance) {
  if (instance.componentType === 'sensor' || instance.componentType === 'battery' || instance.componentType === 'charging') return false;
  if (instance.componentType === 'custom' && instance.definitionId === 'charging.connection') return false;
  return true;
}
