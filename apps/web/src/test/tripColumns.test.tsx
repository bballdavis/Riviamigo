import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('./mockPrimitives');
  return m;
});

describe('trip columns', () => {
  it('keeps the details action inset from the right edge', () => {
    const trip: TripRow = {
      id: 'trip-1',
      started_at: '2024-01-01T12:00:00Z',
      ended_at: '2024-01-01T13:00:00Z',
      distance_mi: 18.3,
      duration_min: 60,
      energy_used_kwh: 6.5,
      efficiency_wh_mi: 355,
      soc_start: 80,
      soc_end: 68,
    };

    const { container } = render(
      <DataTable
        data={[trip]}
        columns={createTripColumns([], { onInfoClick: vi.fn() })}
      />,
    );

    const button = screen.getByRole('button', { name: 'Open trip details' });
    const wrapper = button.parentElement;

    if (!wrapper) throw new Error('Expected the info button to have a wrapper element');
    expect(wrapper).toHaveClass('ml-auto', 'mr-1');

    const detailsHeader = container.querySelector('th:last-child');
    if (!detailsHeader) throw new Error('Expected the details header cell to render');
    expect(detailsHeader).toHaveClass('w-[3.25rem]');
  });

  it('shows a dash instead of zero coordinates for unknown trip locations', () => {
    const trip: TripRow = {
      id: 'trip-2',
      started_at: '2024-01-01T12:00:00Z',
      ended_at: '2024-01-01T13:00:00Z',
      distance_mi: 18.3,
      duration_min: 60,
      energy_used_kwh: 6.5,
      efficiency_wh_mi: 355,
      soc_start: 80,
      soc_end: 68,
      drive_mode: 'All-Purpose',
      start_lat: 0,
      start_lng: 0,
      end_lat: 0,
      end_lng: 0,
    };

    render(
      <DataTable
        data={[trip]}
        columns={createTripColumns()}
      />,
    );

    expect(screen.queryByText('0.00000, 0.00000')).not.toBeInTheDocument();
    expect(screen.getAllByText('-')).toHaveLength(2);
  });
});
