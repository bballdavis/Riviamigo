import React from 'react';
import type { DashboardComponentType, WidgetInstance } from './schema';

export type { WidgetInstance };

export interface WidgetCtx {
  vehicleId: string | null;
  from: string;
  to: string;
  chargeSessionId?: string | null;
}

export interface WidgetDef {
  componentType: DashboardComponentType;
  definitionId: string;
  title: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  defaultOptions?: Record<string, unknown>;
  component: React.ComponentType<{ instance: WidgetInstance; ctx: WidgetCtx }>;
}

const registry = new Map<string, WidgetDef>();

export function widgetKey(componentType: DashboardComponentType, definitionId: string) {
  return `${componentType}:${definitionId}`;
}

export function registerWidget(def: WidgetDef) {
  registry.set(widgetKey(def.componentType, def.definitionId), def);
}

export function getWidget(componentType: DashboardComponentType, definitionId: string): WidgetDef | undefined {
  return registry.get(widgetKey(componentType, definitionId));
}

export function getWidgetForInstance(instance: WidgetInstance): WidgetDef | undefined {
  return getWidget(instance.componentType, instance.definitionId);
}

export function getAllWidgets(): WidgetDef[] {
  return Array.from(registry.values());
}

export function getWidgetKeys(): string[] {
  return Array.from(registry.keys());
}
