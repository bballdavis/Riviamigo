import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../packages/dashboards/src/registry', () => ({
  getWidgetForInstance: (instance: { componentType: string; definitionId: string }) => ({
    componentType: instance.componentType,
    definitionId: instance.definitionId,
    title: instance.definitionId,
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    component: ({ instance }: { instance: { definitionId: string } }) => (
      <div data-testid="widget-body">body:{instance.definitionId}</div>
    ),
  }),
}));

import { WidgetHost } from '../../../../packages/dashboards/src/WidgetHost';

describe('WidgetHost titles', () => {
  it('hides the outer title for trips stat chips while keeping the chip body intact', () => {
    render(
      <WidgetHost
        instance={{ componentType: 'custom', definitionId: 'trips.stat', title: 'Miles Driven' } as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01', to: '2024-01-31' } as never}
      />,
    );

    expect(screen.queryByText('Miles Driven')).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-body')).toHaveTextContent('body:trips.stat');
  });

  it('still shows the outer title for other custom widgets', () => {
    render(
      <WidgetHost
        instance={{ componentType: 'custom', definitionId: 'custom.example', title: 'Custom Widget' } as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01', to: '2024-01-31' } as never}
      />,
    );

    expect(screen.getByText('Custom Widget')).toBeInTheDocument();
    expect(screen.getByTestId('widget-body')).toHaveTextContent('body:custom.example');
  });
});
