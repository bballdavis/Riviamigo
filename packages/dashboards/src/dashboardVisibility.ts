import type { VehicleStatus } from '@riviamigo/types';
import type {
  DashboardVisibilityRule,
  DashboardVisibilityRuleType,
  VehicleConnectionVisibilityValue,
  WidgetInstance,
} from './schema';

export interface DashboardVisibilityState {
  'vehicle-connection': VehicleConnectionVisibilityValue;
}

interface VisibilityValueDefinition<T extends string> {
  value: T;
  label: string;
}

interface VisibilityConditionDefinition<T extends DashboardVisibilityRuleType, V extends string> {
  type: T;
  label: string;
  values: readonly VisibilityValueDefinition<V>[];
  resolve: (status: VehicleStatus | null | undefined) => V;
}

export const DASHBOARD_VISIBILITY_CONDITIONS = {
  'vehicle-connection': {
    type: 'vehicle-connection',
    label: 'Vehicle connection',
    values: [
      { value: 'plugged', label: 'Plugged in' },
      { value: 'unplugged', label: 'Unplugged' },
    ],
    resolve: (status) => isVehiclePluggedIn(status) ? 'plugged' : 'unplugged',
  } satisfies VisibilityConditionDefinition<'vehicle-connection', VehicleConnectionVisibilityValue>,
} as const;

export const DEFAULT_DASHBOARD_VISIBILITY_STATE: DashboardVisibilityState = {
  'vehicle-connection': 'unplugged',
};

export function dashboardVisibilityStateFromStatus(
  status: VehicleStatus | null | undefined,
): DashboardVisibilityState {
  return {
    'vehicle-connection': DASHBOARD_VISIBILITY_CONDITIONS['vehicle-connection'].resolve(status),
  };
}

export function isVehiclePluggedIn(status: VehicleStatus | null | undefined) {
  // A Rivian can remain connected while in standby without continuously
  // refreshing charger_state, so connection is semantic rather than timestamp-based.
  const state = status?.charger_state?.toLowerCase();
  if (state && !['unknown', 'disconnected'].includes(state)) return true;
  return Boolean(status?.charger_status && status.charger_status !== 'chrgr_sts_not_connected');
}

export function getWidgetVisibilityRules(widget: WidgetInstance): DashboardVisibilityRule[] {
  if (widget.visibility?.length) return widget.visibility;

  // Compatibility for saved/imported v2 configs that predate typed rules.
  const legacy = widget.options?.['chargingConnectionVisibility'];
  return legacy === 'plugged' || legacy === 'unplugged'
    ? [{ type: 'vehicle-connection', value: legacy }]
    : [];
}

export function hasDashboardVisibilityRules(widgets: readonly WidgetInstance[]) {
  return widgets.some((widget) => getWidgetVisibilityRules(widget).length > 0);
}

export function getDashboardVisibilityRuleTypes(
  widgets: readonly WidgetInstance[],
): DashboardVisibilityRuleType[] {
  return [...new Set(
    widgets.flatMap((widget) => getWidgetVisibilityRules(widget).map((rule) => rule.type)),
  )];
}

export function isWidgetVisible(
  widget: WidgetInstance,
  state: DashboardVisibilityState,
) {
  return getWidgetVisibilityRules(widget).every((rule) => state[rule.type] === rule.value);
}

export function setVehicleConnectionVisibility(
  widget: WidgetInstance,
  value: VehicleConnectionVisibilityValue | null,
): WidgetInstance {
  const remaining = getWidgetVisibilityRules(widget).filter((rule) => rule.type !== 'vehicle-connection');
  const visibility = value
    ? [...remaining, { type: 'vehicle-connection' as const, value }]
    : remaining;

  if (visibility.length === 0) {
    const next = { ...widget };
    delete next.visibility;
    return next;
  }

  return { ...widget, visibility };
}

export function migrateLegacyWidgetVisibility(widget: WidgetInstance): WidgetInstance {
  const legacy = widget.options?.['chargingConnectionVisibility'];
  if (legacy !== 'plugged' && legacy !== 'unplugged') return widget;

  const options = { ...(widget.options ?? {}) };
  delete options['chargingConnectionVisibility'];
  const migrated = widget.visibility?.length
    ? widget
    : setVehicleConnectionVisibility(widget, legacy);

  return {
    ...migrated,
    ...(Object.keys(options).length > 0 ? { options } : { options: {} }),
  };
}
