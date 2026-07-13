import type React from 'react';
import type { DashboardTimeframe } from '@riviamigo/types';
import type { DashboardDataRequirements } from './dashboardData';
import type { DashboardVisibilityState } from './dashboardVisibility';
import type { DashboardComponentType, WidgetInstance } from './schema';

export type { WidgetInstance };

export interface WidgetCtx {
  vehicleId: string | null;
  dashboardSlug?: string;
  timeframe?: DashboardTimeframe;
  from: string | null;
  to: string | null;
  chargeSessionDayLocal?: string | null;
  setChargeSessionDayLocal?: (dayLocal: string | null) => void;
  chargeSessionId?: string | null;
  chargeSessionEnergyKwh?: number | null;
  updateWidgetOptions?: (widgetId: string, patch: Record<string, unknown>) => void;
  updateWidgetLayout?: (widgetId: string, nextHeight: number) => void;
  /** Temporary editor preview state; absent in normal dashboard view mode. */
  visibilityState?: DashboardVisibilityState;
}

export interface WidgetEditorMeta {
  category?: string;
  description?: string;
  deprecated: boolean;
  fixedSize: boolean;
  movable: boolean;
  resizable: boolean;
  maxSize?: { w: number; h: number };
}

export interface WidgetDef {
  componentType: DashboardComponentType;
  definitionId: string;
  title: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  defaultOptions?: Record<string, unknown>;
  /** Declares the compact shared data this widget needs in dashboard view. */
  dataRequirements?: (instance: WidgetInstance) => DashboardDataRequirements | undefined;
  editor?: Partial<WidgetEditorMeta>;
  component: React.ComponentType<{ instance: WidgetInstance; ctx: WidgetCtx }>;
}

const registry = new Map<string, WidgetDef>();
const editorRegistry = new Map<string, WidgetEditorMeta>();

const DEFAULT_EDITOR_META: WidgetEditorMeta = {
  deprecated: false,
  fixedSize: false,
  movable: true,
  resizable: true,
};

export function widgetKey(componentType: DashboardComponentType, definitionId: string) {
  return `${componentType}:${definitionId}`;
}

export function registerWidget(def: WidgetDef) {
  const key = widgetKey(def.componentType, def.definitionId);
  const editorMeta: WidgetEditorMeta = {
    ...DEFAULT_EDITOR_META,
    ...def.editor,
  };
  if (editorMeta.fixedSize) {
    editorMeta.resizable = false;
  }
  registry.set(key, def);
  editorRegistry.set(key, editorMeta);
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

export function getWidgetEditorMeta(def: WidgetDef | undefined): WidgetEditorMeta {
  if (!def) return DEFAULT_EDITOR_META;
  return editorRegistry.get(widgetKey(def.componentType, def.definitionId)) ?? DEFAULT_EDITOR_META;
}
