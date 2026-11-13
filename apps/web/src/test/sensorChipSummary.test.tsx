import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
// Import the chip module directly, not the package index, so the dashboard
// editor's icon picker is not loaded alongside it.
import { SensorChipSummary } from '../../../../packages/dashboards/src/widgets/sensor/SensorChipSummary';
import { providerRegistrations } from './mocks/iconify-react';

describe('SensorChipSummary', () => {
  it('configures the icon proxy without the dashboard editor being loaded', () => {
    expect(providerRegistrations).toContainEqual({ prefix: '', resources: ['/v1/external/iconify'] });
  });

  it('shows the icon from its sensor definition', () => {
    render(<SensorChipSummary definitionId="charging_total_cost" title="Cost" value="$0.39" />);

    expect(screen.getByTestId('sensor-chip-icon')).toHaveAttribute('data-iconify', 'lucide:dollar-sign');
    expect(screen.getByText('$0.39')).toBeInTheDocument();
  });

  it('lets an explicit icon win over the definition and falls back without one', () => {
    const { rerender } = render(
      <SensorChipSummary definitionId="charging_total_cost" title="Cost" value="$1" icon="lucide:receipt" />,
    );
    expect(screen.getByTestId('sensor-chip-icon')).toHaveAttribute('data-iconify', 'lucide:receipt');

    rerender(<SensorChipSummary title="Duration" value="8h" />);
    expect(screen.getByTestId('sensor-chip-icon')).toHaveAttribute('data-iconify', 'lucide:activity');
  });
});
