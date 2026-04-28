import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Workspace package stubs ───────────────────────────────────────────────────
vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/ui/charts', () => ({
  SocAreaChart:       ({ loading }: { loading?: boolean }) => <div data-testid="soc-chart">{loading ? 'loading' : 'soc-chart'}</div>,
  RangeAreaChart:     () => <div data-testid="range-chart" />,
  PhantomDrainChart:  () => <div data-testid="drain-chart" />,
  DegradationChart:   () => <div data-testid="degrad-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth:         () => ({ defaultVehicleId: 'v1' }),
  useSocHistory:   () => ({ data: [], isLoading: false }),
  useRangeHistory: () => ({ data: [], isLoading: false }),
  usePhantomDrain: () => ({ data: [], isLoading: false }),
  useDegradation:  () => ({ data: [], isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (v: number) => `${v} mi`,
  formatKwh:   (v: number) => `${v} kWh`,
  formatCurrency: (v: number) => `$${v}`,
  formatPercent: (v: number) => `${v}%`,
  formatDuration: (v: number) => `${v} min`,
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { BatteryContent } from '../battery';

describe('Battery page', () => {
  it('renders all four stat card labels', () => {
    render(<BatteryContent />);
    expect(screen.getByText('Current SoC')).toBeInTheDocument();
    expect(screen.getByText('Est. Range')).toBeInTheDocument();
    expect(screen.getAllByText('Phantom Drain').length).toBeGreaterThan(0);
    expect(screen.getByText('Capacity Health')).toBeInTheDocument();
  });

  it('shows SoC chart by default', () => {
    render(<BatteryContent />);
    expect(screen.getByTestId('soc-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('range-chart')).not.toBeInTheDocument();
  });

  it('switches to Range chart when Range tab is clicked', () => {
    render(<BatteryContent />);
    fireEvent.click(screen.getByText('Range'));
    expect(screen.getByTestId('range-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('soc-chart')).not.toBeInTheDocument();
  });

  it('switches to Phantom Drain chart', () => {
    render(<BatteryContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Phantom Drain' }));
    expect(screen.getByTestId('drain-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('soc-chart')).not.toBeInTheDocument();
  });

  it('switches to Degradation chart', () => {
    render(<BatteryContent />);
    fireEvent.click(screen.getByText('Degradation'));
    expect(screen.getByTestId('degrad-chart')).toBeInTheDocument();
  });

  it('renders all four tab labels in the nav', () => {
    render(<BatteryContent />);
    expect(screen.getByRole('button', { name: 'State of Charge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phantom Drain' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Degradation' })).toBeInTheDocument();
  });

  it('shows dash placeholder when no data', () => {
    render(<BatteryContent />);
    // latestSoc undefined → '—'
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
