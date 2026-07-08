import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DailyChargeSessionsChart } from '../../../../packages/ui/src/charts/DailyChargeSessionsChart';

describe('DailyChargeSessionsChart', () => {
  it('groups sessions into stable legend categories and rounds the outer stack shape', () => {
    const { container } = render(
      <DailyChargeSessionsChart
        daily={[
          {
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            total_energy_kwh: 0,
            session_count: 3,
          },
          {
            day_local: '2024-01-02',
            day_start: '2024-01-02T00:00:00Z',
            total_energy_kwh: 70,
            session_count: 1,
          },
        ]}
        dailySessions={[
          {
            session_id: 's1',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T10:00:00Z',
            energy_added_kwh: 10,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's2',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T12:00:00Z',
            energy_added_kwh: 20,
            charger_type: 'dc',
            location_name: 'Office',
          },
          {
            session_id: 's3',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T13:00:00Z',
            energy_added_kwh: 5,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's4',
            day_local: '2024-01-02',
            day_start: '2024-01-02T00:00:00Z',
            started_at: '2024-01-02T09:00:00Z',
            energy_added_kwh: 70,
            charger_type: 'ac',
            location_name: 'Fast Charger',
          },
        ]}
      />,
    );

    expect(screen.getByText('AC')).toBeTruthy();
    expect(screen.getByText('DC')).toBeTruthy();
    expect(screen.queryByText('Unknown')).toBeNull();

    const segments = container.querySelectorAll('[data-testid="daily-charge-segment"]');
    expect(segments).toHaveLength(3);
    segments.forEach((segment) => {
      expect(segment.getAttribute('rx')).toBeNull();
    });

    const hitArea = container.querySelector('rect[role="button"]');
    expect(hitArea?.getAttribute('y')).toBe('118');
    expect(hitArea?.getAttribute('height')).toBe('98');

    const clipRect = container.querySelector('clipPath rect');
    expect(clipRect?.getAttribute('rx')).toBe('8');
  });

  it('shows hover details for the active day stack', () => {
    render(
      <DailyChargeSessionsChart
        daily={[
          {
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            total_energy_kwh: 0,
            session_count: 2,
          },
        ]}
        dailySessions={[
          {
            session_id: 's1',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T10:00:00Z',
            energy_added_kwh: 24,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's2',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T17:00:00Z',
            energy_added_kwh: 16,
            charger_type: 'dc',
            location_name: 'Office',
          },
        ]}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /40 kWh across 2 sessions/i }));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent ?? '').toContain('40 kWh total');
    expect(tooltip.textContent ?? '').toContain('AC');
    expect(tooltip.textContent ?? '').toContain('DC');
    expect(tooltip.textContent ?? '').toContain('2 sessions');
  });

  it('calls day-click callback and toggles when clicked again', () => {
    function TestHarness() {
      const [selectedDay, setSelectedDay] = useState<string | null>(null);
      return (
        <>
          <DailyChargeSessionsChart
            daily={[
              {
                day_local: '2024-01-01',
                day_start: '2024-01-01T00:00:00Z',
                total_energy_kwh: 12,
                session_count: 1,
              },
            ]}
            dailySessions={[
              {
                session_id: 's1',
                day_local: '2024-01-01',
                day_start: '2024-01-01T00:00:00Z',
                started_at: '2024-01-01T10:00:00Z',
                energy_added_kwh: 12,
                charger_type: 'ac',
                location_name: 'Home',
              },
            ]}
            selectedDayLocal={selectedDay}
            onDayClick={setSelectedDay}
          />
          <p data-testid="selected-day">{selectedDay ?? 'none'}</p>
        </>
      );
    }

    render(<TestHarness />);
    const bar = screen.getByRole('button', { name: /12 kWh across 1 session/i });
    fireEvent.click(bar);
    expect(screen.getByTestId('selected-day').textContent).toBe('2024-01-01');
    fireEvent.click(bar);
    expect(screen.getByTestId('selected-day').textContent).toBe('none');
  });
});
