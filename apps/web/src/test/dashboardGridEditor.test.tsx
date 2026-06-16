import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../../../packages/dashboards/src';
import GridEditor from '../../../../packages/dashboards/src/GridEditor';
import type { DashboardConfig } from '@riviamigo/dashboards';

vi.mock('@riviamigo/hooks', () => ({
  useMetricCatalog: () => ({ data: [] }),
}));

vi.mock('../../../../packages/dashboards/src/WidgetHost', () => ({
  WidgetHost: ({ instance }: { instance: { id: string; definitionId: string } }) => (
    <div data-testid={`widget-host-${instance.id}`}>{instance.definitionId}</div>
  ),
}));

const BASE_CTX = {
  vehicleId: 'vehicle-1',
  from: '2026-06-01T00:00:00Z',
  to: '2026-06-10T00:00:00Z',
};

const BASE_CONFIG: DashboardConfig = {
  schemaVersion: 2,
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'editor-test',
  name: 'Editor Test',
  isDefault: false,
  isLocked: false,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      componentType: 'sensor',
      definitionId: 'total_miles',
      title: 'Miles',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {},
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      componentType: 'custom',
      definitionId: 'trips.stat',
      title: 'Trips',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: {},
    },
  ],
};

describe('GridEditor overlays', () => {
  it('renders move and edit overlays for resizable and fixed widgets, while only resizable widgets get resize handles', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const resizableLeft = screen.getByTestId('widget-overlay-left-22222222-2222-2222-2222-222222222222');
    const resizableRight = screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222');
    const fixedLeft = screen.getByTestId('widget-overlay-left-33333333-3333-3333-3333-333333333333');
    const fixedRight = screen.getByTestId('widget-overlay-right-33333333-3333-3333-3333-333333333333');

    expect(within(resizableLeft).getByRole('button', { name: 'Drag to move' })).toBeInTheDocument();
    expect(within(resizableRight).getByRole('button', { name: 'Edit widget settings' })).toBeInTheDocument();
    expect(within(fixedLeft).getByRole('button', { name: 'Drag to move' })).toBeInTheDocument();
    expect(within(fixedLeft).getByLabelText('Fixed-size widget')).toBeInTheDocument();
    expect(within(fixedRight).getByRole('button', { name: 'Edit widget settings' })).toBeInTheDocument();

    const resizableCard = screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222').closest('[data-fixed-size="false"]');
    const fixedCard = screen.getByTestId('widget-host-33333333-3333-3333-3333-333333333333').closest('[data-fixed-size="true"]');
    const fixedGridItem = screen.getByTestId('widget-host-33333333-3333-3333-3333-333333333333').closest('.react-grid-item');

    expect(resizableCard?.querySelector('.react-resizable-handle')).not.toBeNull();
    expect(fixedCard?.querySelector('.react-resizable-handle')).not.toBeNull();
    expect(fixedGridItem?.className).toContain('react-resizable-hide');
  });

  it('keeps move and edit overlays visible while the widget editor drawer is open', () => {
    render(
      <GridEditor
        config={BASE_CONFIG}
        ctx={BASE_CTX}
        onConfigChange={() => undefined}
      />
    );

    const leftOverlay = screen.getByTestId('widget-overlay-left-22222222-2222-2222-2222-222222222222');
    const rightOverlay = screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222');

    expect(leftOverlay.className).toContain('opacity-0');
    expect(rightOverlay.className).toContain('opacity-0');

    fireEvent.click(within(rightOverlay).getByRole('button', { name: 'Edit widget settings' }));

    expect(leftOverlay.className).toContain('opacity-100');
    expect(rightOverlay.className).toContain('opacity-100');
    expect(screen.getByRole('button', { name: 'Remove component' })).toBeInTheDocument();
  });

  it('confirms widget deletion from the drawer before removing the widget', () => {
    function Harness() {
      const [config, setConfig] = React.useState(BASE_CONFIG);
      return <GridEditor config={config} ctx={BASE_CTX} onConfigChange={setConfig} />;
    }

    render(<Harness />);

    fireEvent.click(
      within(screen.getByTestId('widget-overlay-right-22222222-2222-2222-2222-222222222222'))
        .getByRole('button', { name: 'Edit widget settings' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(screen.getByText('Delete this widget?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this widget?')).toBeNull();
    expect(screen.getByTestId('widget-host-22222222-2222-2222-2222-222222222222')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Widget' }));

    expect(screen.queryByTestId('widget-host-22222222-2222-2222-2222-222222222222')).toBeNull();
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();
  });
});
