import { describe, expect, it } from 'vitest';
import {
  dashboardVisibilityStateFromStatus,
  exportDashboardYaml,
  importDashboardYaml,
  isWidgetVisible,
  normalizeDashboardConfig,
  type DashboardConfig,
  type WidgetInstance,
} from '@riviamigo/dashboards';
import type { VehicleStatus } from '@riviamigo/types';

const conditionalWidget: WidgetInstance = {
  id: '11111111-1111-4111-8111-111111111111',
  componentType: 'sensor',
  definitionId: 'charging_avg_session',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  visibility: [{ type: 'vehicle-connection', value: 'plugged' }],
};

const config: DashboardConfig = {
  schemaVersion: 2,
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'charging',
  name: 'Charging',
  isDefault: false,
  isLocked: false,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [conditionalWidget],
};

describe('dashboard visibility rules', () => {
  it('keeps unconditional widgets visible and applies multiple rules with AND semantics', () => {
    const unconditional = { ...conditionalWidget, visibility: undefined };
    const contradictory = {
      ...conditionalWidget,
      visibility: [
        { type: 'vehicle-connection' as const, value: 'plugged' as const },
        { type: 'vehicle-connection' as const, value: 'unplugged' as const },
      ],
    };

    expect(isWidgetVisible(unconditional, { 'vehicle-connection': 'unplugged' })).toBe(true);
    expect(isWidgetVisible(conditionalWidget, { 'vehicle-connection': 'plugged' })).toBe(true);
    expect(isWidgetVisible(conditionalWidget, { 'vehicle-connection': 'unplugged' })).toBe(false);
    expect(isWidgetVisible(contradictory, { 'vehicle-connection': 'plugged' })).toBe(false);
  });

  it('treats connected standby as plugged and unknown status as unplugged', () => {
    const standby = { charger_state: 'standby' } as unknown as VehicleStatus;

    expect(dashboardVisibilityStateFromStatus(standby)).toEqual({ 'vehicle-connection': 'plugged' });
    expect(dashboardVisibilityStateFromStatus(undefined)).toEqual({ 'vehicle-connection': 'unplugged' });
  });

  it('migrates legacy widget options to typed rules without changing other options', () => {
    const legacy = {
      ...config,
      widgets: [{
        ...conditionalWidget,
        visibility: undefined,
        options: { chargingConnectionVisibility: 'unplugged', accent: true },
      }],
    };
    const normalized = normalizeDashboardConfig(legacy);

    expect(normalized.widgets[0]?.visibility).toEqual([
      { type: 'vehicle-connection', value: 'unplugged' },
    ]);
    expect(normalized.widgets[0]?.options).toEqual({ accent: true });
  });

  it('round-trips typed rules through dashboard YAML', () => {
    const imported = importDashboardYaml(exportDashboardYaml(config));

    expect(imported.widgets[0]?.visibility).toEqual(conditionalWidget.visibility);
  });
});
