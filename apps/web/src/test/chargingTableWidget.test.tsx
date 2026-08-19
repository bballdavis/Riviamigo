import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('./mockPrimitives');
  return m;
});

const sessions = Array.from({ length: 39 }, (_, index) => ({
  id: `charge-${index + 1}`,
  started_at: `2024-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  session_day_local: null,
  duration_min: 60,
  energy_added_kwh: 40 + index,
  soc_start: 20,
  soc_end: 80,
  peak_power_kw: 11,
  cost_usd: 10,
  charger_type: 'ac_l2',
  location_name: `Home ${index + 1}`,
  network_vendor: null,
  range_added_km: null,
  is_free_session: false,
  is_rivian_network: false,
  rivian_paid_total: null,
}));

vi.mock('@riviamigo/hooks', () => ({
  useChargeSessions: () => ({
    data: { items: sessions, total: 39, page: 1, per_page: 100 },
    isLoading: false,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import { ChargingTableWidget } from '../../../../packages/dashboards/src/widgets/table/ChargingTableWidget';

describe('ChargingTableWidget', () => {
  it('renders every session for a 100-row desktop page', () => {
    const { container } = render(
      <ChargingTableWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01', to: '2024-01-31' }}
      />,
    );

    const rowsPerPage = screen.getByRole('combobox', { name: 'Charging sessions per page' });
    expect(rowsPerPage).toHaveValue('15');
    expect(screen.getByRole('option', { name: '100' })).toBeInTheDocument();
    fireEvent.change(rowsPerPage, { target: { value: '100' } });
    expect(rowsPerPage).toHaveValue('100');
    expect(screen.getByText('Page 1 of 1 · 39 sessions')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(40);
    expect(container.firstElementChild).toHaveClass('!h-auto');
  });
});
