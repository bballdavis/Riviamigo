import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChargeSessionRow } from '../../../../packages/ui/src/tables/chargingColumns';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('./mockPrimitives');
  return m;
});

const sessions: ChargeSessionRow[] = Array.from({ length: 39 }, (_, index) => ({
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

  it('uses live fallbacks and pending cost for an active desktop row', () => {
    sessions[0] = {
      ...sessions[0]!, ended_at: null, energy_added_kwh: null, duration_min: null, soc_end: null,
      peak_power_kw: null, cost_usd: null, live_total_charged_kwh: 9.5, live_time_elapsed_seconds: 1200,
      live_soc_pct: 44, live_power_kw: 7.2, live_range_added_km: 31.4,
    };
    render(<ChargingTableWidget instance={{} as never} ctx={{ vehicleId: 'vehicle-1', from: null, to: null }} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('9.5 kWh · Live')).toBeInTheDocument();
    expect(within(table).getByText('20% → 44% · Live')).toBeInTheDocument();
    expect(within(table).getByText('20m · Live')).toBeInTheDocument();
    expect(within(table).getByText('Pending')).toBeInTheDocument();
  });

  it('uses live fallbacks on the mobile session card', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    sessions[0] = { ...sessions[0]!, ended_at: null, energy_added_kwh: null, duration_min: null, live_total_charged_kwh: 8.2, live_time_elapsed_seconds: 600, live_power_kw: 6.1, live_soc_pct: 35, soc_end: null, cost_usd: null };
    render(<ChargingTableWidget instance={{} as never} ctx={{ vehicleId: 'vehicle-1', from: null, to: null }} />);
    expect(screen.getByText('8.2 kWh · Live')).toBeInTheDocument();
    expect(screen.getByText('10m · Live')).toBeInTheDocument();
    expect(screen.getByText('Power 6.1 kW')).toBeInTheDocument();
  });
});
