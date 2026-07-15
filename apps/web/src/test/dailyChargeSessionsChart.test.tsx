import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DailyChargeSessionsChart, DailyEnergyBarChart } from '../../../../packages/ui/src/charts/DailyChargeSessionsChart';

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
            cost_usd: 1.25,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's2',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T12:00:00Z',
            energy_added_kwh: 20,
            cost_usd: 4.5,
            charger_type: 'dc',
            location_name: 'Office',
          },
          {
            session_id: 's3',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T13:00:00Z',
            energy_added_kwh: 5,
            cost_usd: 0.75,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's4',
            day_local: '2024-01-02',
            day_start: '2024-01-02T00:00:00Z',
            started_at: '2024-01-02T09:00:00Z',
            energy_added_kwh: 70,
            cost_usd: 3.25,
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
    const hitAreaY = Number(hitArea?.getAttribute('y'));
    const hitAreaHeight = Number(hitArea?.getAttribute('height'));
    expect(hitAreaY).toBeGreaterThan(0);
    expect(hitAreaHeight).toBeGreaterThan(0);
    expect(hitAreaY + hitAreaHeight).toBeCloseTo(216, 3);

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
            cost_usd: 2.4,
            charger_type: 'ac',
            location_name: 'Home',
          },
          {
            session_id: 's2',
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            started_at: '2024-01-01T17:00:00Z',
            energy_added_kwh: 16,
            cost_usd: 5.6,
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
    expect(tooltip.textContent ?? '').toContain('$2.40');
    expect(tooltip.textContent ?? '').toContain('$5.60');
    expect(tooltip.textContent ?? '').toContain('2 sessions');
  });

  it('renders total-energy bars with the shared filled treatment and hover copy', () => {
    const { container } = render(
      <DailyEnergyBarChart
        daily={[
          {
            day_local: '2024-01-01',
            day_start: '2024-01-01T00:00:00Z',
            total_energy_kwh: 40,
            session_count: 2,
          },
        ]}
      />,
    );

    const bar = container.querySelector('[data-testid="daily-energy-bar"]');
    expect(bar).toBeTruthy();
    expect(screen.getByTestId('daily-energy-chart')).toBeTruthy();
    expect(bar?.getAttribute('fill')).not.toBe('transparent');

    fireEvent.mouseEnter(screen.getByRole('button', { name: /40 kWh energy charged/i }));

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent ?? '').toContain('Energy Charged: 40 kWh');
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
                cost_usd: null,
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

  it('zooms a dragged day range and restores the full chart from the icon control', () => {
    render(
      <DailyEnergyBarChart
        daily={Array.from({ length: 4 }, (_, index) => ({
          day_local: `2024-01-0${index + 1}`,
          day_start: `2024-01-0${index + 1}T00:00:00Z`,
          total_energy_kwh: 10 + index,
          session_count: 1,
        }))}
      />,
    );

    const chart = screen.getByTestId('daily-energy-chart');
    Object.defineProperty(chart, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 960 }),
    });

    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(chart, event);
    };
    pointerEvent('pointerdown', 90);
    pointerEvent('pointermove', 700);
    pointerEvent('pointerup', 700);

    const reset = screen.getByRole('button', { name: 'Return to full chart view' });
    expect(reset.querySelector('svg')).toBeTruthy();
    fireEvent.click(reset);
    expect(screen.queryByRole('button', { name: 'Return to full chart view' })).toBeNull();
  });
});
