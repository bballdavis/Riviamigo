import { v4 as uuidv4 } from 'uuid';
import type { DashboardConfig, WidgetInstance, WidgetLayout } from './schema';
import type { WidgetDef } from './registry';
import { sanitizeDashboardConfig, sanitizeWidgetInstance, sanitizeWidgetLayout } from './layout';

export const DASHBOARD_GRID_COLUMNS = 12;
export const DASHBOARD_ROW_HEIGHT = 40;
export const CHARGING_CONNECTION_VISIBILITY_OPTION = 'chargingConnectionVisibility';

export type DashboardOwnership = 'system-default' | 'user-owned';
export type ChargingConnectionVisibility = 'plugged' | 'unplugged';

export interface DashboardLayoutPatch {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function dashboardKey(config: DashboardConfig | null | undefined, fallbackSlug: string) {
  return config ? `${config.id}:${config.slug}` : `pending:${fallbackSlug}`;
}

export function widgetKeyForInstance(widget: WidgetInstance) {
  return `${widget.id}:${widget.componentType}:${widget.definitionId}`;
}

export function getDashboardOwnership(config: DashboardConfig): DashboardOwnership {
  return config.ownerId ? 'user-owned' : 'system-default';
}

export function isSystemDefaultDashboard(config: DashboardConfig) {
  return config.isDefault && !config.ownerId;
}

export function isUserOwnedDashboard(config: DashboardConfig) {
  return Boolean(config.ownerId);
}

export function findOwnedDashboardBySlug(
  dashboards: DashboardConfig[] | undefined,
  slug: string,
): DashboardConfig | undefined {
  return dashboards?.find((dashboard) => dashboard.slug === slug && dashboard.ownerId != null);
}

export function materializeUserDashboardDraft(
  draft: DashboardConfig,
  ownedCopy?: DashboardConfig | null,
): DashboardConfig {
  return sanitizeDashboardConfig({
    ...draft,
    id: ownedCopy?.id ?? (draft.ownerId ? draft.id : uuidv4()),
    ownerId: ownedCopy?.ownerId ?? draft.ownerId ?? null,
    isDefault: false,
    isLocked: false,
  });
}

export function materializeSystemDashboardDraft(
  draft: DashboardConfig,
  systemDefault: DashboardConfig,
): DashboardConfig {
  return sanitizeDashboardConfig({
    ...draft,
    id: systemDefault.id,
    ownerId: systemDefault.ownerId,
    isDefault: true,
    isLocked: systemDefault.isLocked,
  });
}

export function createWidgetInstance(
  def: WidgetDef,
  layout: Pick<WidgetLayout, 'x' | 'y'> & Partial<Pick<WidgetLayout, 'w' | 'h'>>,
): WidgetInstance {
  return sanitizeWidgetInstance({
    id: uuidv4(),
    componentType: def.componentType,
    definitionId: def.definitionId,
    title: def.title,
    layout: {
      x: layout.x,
      y: layout.y,
      w: layout.w ?? def.defaultSize.w,
      h: layout.h ?? def.defaultSize.h,
    },
    options: def.defaultOptions,
  });
}

export function applyWidgetLayout(
  widgets: WidgetInstance[],
  layout: readonly DashboardLayoutPatch[],
): WidgetInstance[] {
  const map = new Map(layout.map((item) => [item.i, item]));
  let changed = false;

  const next = widgets.map((widget) => {
    const item = map.get(widget.id);
    if (!item) return widget;

    const candidate = sanitizeWidgetInstance({
      ...widget,
      layout: sanitizeWidgetLayout({ x: item.x, y: item.y, w: item.w, h: item.h }),
    });

    if (layoutsEqual(candidate.layout, widget.layout)) return widget;
    changed = true;
    return candidate;
  });

  return changed ? next : widgets;
}

export function getChargingConnectionVisibility(widget: WidgetInstance) {
  const value = widget.options?.[CHARGING_CONNECTION_VISIBILITY_OPTION];
  return value === 'plugged' || value === 'unplugged'
    ? (value as ChargingConnectionVisibility)
    : null;
}

export function hasDashboardVisibilityRules(widgets: readonly WidgetInstance[]) {
  return widgets.some((widget) => getChargingConnectionVisibility(widget));
}

export function resolveDashboardViewWidgets(
  widgets: readonly WidgetInstance[],
  state: { pluggedIn: boolean },
): WidgetInstance[] {
  const visibleWidgets = widgets.filter((widget) => {
    const visibility = getChargingConnectionVisibility(widget);
    if (visibility === 'plugged') return state.pluggedIn;
    if (visibility === 'unplugged') return !state.pluggedIn;
    return true;
  });

  return expandUnpluggedChargingMixRow(visibleWidgets, state.pluggedIn);
}

function expandUnpluggedChargingMixRow(
  widgets: readonly WidgetInstance[],
  pluggedIn: boolean,
): WidgetInstance[] {
  if (pluggedIn) return [...widgets];

  return widgets.map((widget) => {
    if (isChargingMixSensor(widget, 'home')) {
      return { ...widget, layout: { ...widget.layout, x: 0, w: 6 } };
    }
    if (isChargingMixSensor(widget, 'dc')) {
      return { ...widget, layout: { ...widget.layout, x: 6, w: 6 } };
    }
    return widget;
  });
}

function isChargingMixSensor(widget: WidgetInstance, mix: 'home' | 'dc') {
  const oldDefinitionId = mix === 'home' ? 'home_share' : 'dc_share';
  const sensorDefinitionId = mix === 'home' ? 'charging_home_share' : 'charging_dc_share';
  return (
    (widget.componentType === 'charging' && widget.definitionId === oldDefinitionId) ||
    (widget.componentType === 'sensor' && widget.definitionId === sensorDefinitionId)
  );
}

function layoutsEqual(a: WidgetLayout, b: WidgetLayout) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
