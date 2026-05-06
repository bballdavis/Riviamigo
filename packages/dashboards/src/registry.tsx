import React from 'react';
import type { WidgetInstance } from './schema';

export type { WidgetInstance };

export interface WidgetCtx {
  vehicleId: string | null;
  from: string;
  to: string;
}

export interface WidgetDef {
  id: string;
  category: 'stat' | 'chart' | 'table' | 'custom';
  title: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  defaultOptions?: Record<string, unknown>;
  editMode?: 'metric' | 'json' | 'none';
  component: React.ComponentType<{ instance: WidgetInstance; ctx: WidgetCtx }>;
}

const registry = new Map<string, WidgetDef>();

export function registerWidget(def: WidgetDef) {
  registry.set(def.id, def);
}

export function getWidget(id: string): WidgetDef | undefined {
  return registry.get(id);
}

export function getAllWidgets(): WidgetDef[] {
  return Array.from(registry.values());
}

export function getWidgetIds(): string[] {
  return Array.from(registry.keys());
}
