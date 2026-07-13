import { describe, expect, it } from 'vitest';
import {
  applyWidgetLayout,
  findOwnedDashboardBySlug,
  materializeSystemDashboardDraft,
  materializeUserDashboardDraft,
  resolveDashboardViewWidgets,
  type DashboardConfig,
  type WidgetInstance,
} from '@riviamigo/dashboards';

const systemDefault: DashboardConfig = {
  schemaVersion: 2,
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'battery',
  name: 'Battery',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

const userCopy: DashboardConfig = {
  ...systemDefault,
  id: '11111111-1111-1111-1111-111111111111',
  isDefault: false,
  isLocked: false,
  ownerId: '22222222-2222-2222-2222-222222222222',
};

function sensorWidget(
  id: string,
  definitionId: string,
  options: Record<string, unknown>,
  layout: WidgetInstance['layout'],
): WidgetInstance {
  return {
    id,
    componentType: 'sensor',
    definitionId,
    title: definitionId,
    options,
    layout,
  };
}

describe('dashboard model helpers', () => {
  it('finds and materializes user-owned dashboard drafts without leaking default metadata', () => {
    expect(findOwnedDashboardBySlug([systemDefault, userCopy], 'battery')).toBe(userCopy);

    const materialized = materializeUserDashboardDraft(systemDefault, userCopy);

    expect(materialized).toMatchObject({
      id: userCopy.id,
      ownerId: userCopy.ownerId,
      isDefault: false,
      isLocked: false,
      slug: 'battery',
    });
  });

  it('materializes admin system-default drafts with the system row identity', () => {
    const materialized = materializeSystemDashboardDraft(
      { ...systemDefault, id: userCopy.id, ownerId: userCopy.ownerId, isDefault: false },
      systemDefault,
    );

    expect(materialized).toMatchObject({
      id: systemDefault.id,
      ownerId: null,
      isDefault: true,
      isLocked: true,
    });
  });

  it('preserves widget array identity when a layout callback makes no change', () => {
    const widgets = [
      sensorWidget(
        '33333333-3333-3333-3333-333333333333',
        'total_miles',
        {},
        { x: 0, y: 0, w: 3, h: 2 },
      ),
    ];

    const next = applyWidgetLayout(widgets, [{ i: widgets[0]!.id, x: 0, y: 0, w: 3, h: 2 }]);

    expect(next).toBe(widgets);
  });

  it('resolves plugged and unplugged dashboard visibility from widget options', () => {
    const widgets = [
      sensorWidget(
        '44444444-4444-4444-4444-444444444444',
        'charging_home_share',
        {},
        { x: 0, y: 4, w: 3, h: 2 },
      ),
      sensorWidget(
        '55555555-5555-5555-5555-555555555555',
        'charging_dc_share',
        {},
        { x: 3, y: 4, w: 3, h: 2 },
      ),
      sensorWidget(
        '66666666-6666-6666-6666-666666666666',
        'charging_avg_session',
        { chargingConnectionVisibility: 'unplugged' },
        { x: 9, y: 0, w: 3, h: 2 },
      ),
      {
        id: '77777777-7777-7777-7777-777777777777',
        componentType: 'custom' as const,
        definitionId: 'charging.connection',
        title: 'Charging Connection',
        options: { chargingConnectionVisibility: 'plugged' },
        layout: { x: 6, y: 0, w: 6, h: 6 },
      },
    ];

    const unplugged = resolveDashboardViewWidgets(widgets, { 'vehicle-connection': 'unplugged' });
    expect(unplugged.map((widget) => widget.definitionId)).toEqual([
      'charging_home_share',
      'charging_dc_share',
      'charging_avg_session',
    ]);
    expect(unplugged[0]?.layout).toMatchObject({ x: 0, w: 6 });
    expect(unplugged[1]?.layout).toMatchObject({ x: 6, w: 6 });

    const plugged = resolveDashboardViewWidgets(widgets, { 'vehicle-connection': 'plugged' });
    expect(plugged.map((widget) => widget.definitionId)).toEqual([
      'charging_home_share',
      'charging_dc_share',
      'charging.connection',
    ]);
  });
});
