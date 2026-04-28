/**
 * Smoke test — kept as a canary that catches stale compiled .js files
 * shadowing .tsx sources (which previously made BatteryContent disappear).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, it, expect } from 'vitest';

vi.mock('@riviamigo/ui/primitives', () => ({
  PageLayout: ({ children, title, actions }: any) => (
    <div data-testid="page-layout"><h1>{title}</h1>{actions}{children}</div>
  ),
  StatCardGrid: ({ children }: any) => <div>{children}</div>,
  StatCard: ({ label, value }: any) => <div><span>{label}</span><span>{value}</span></div>,
  MetricTabs: ({ children, tabs, active, onChange }: any) => (
    <div data-testid="metric-tabs">
      {tabs.map((t: any) => <button key={t.key} onClick={() => onChange(t.key)}>{t.label}</button>)}
      {children}
    </div>
  ),
  DateRangePicker: () => <div />,
  StatCardSkeleton: () => <div />,
}));
vi.mock('@riviamigo/ui/charts', () => ({
  SocAreaChart: () => <div data-testid="soc" />,
  RangeAreaChart: () => <div />,
  PhantomDrainChart: () => <div />,
  DegradationChart: () => <div />,
}));
vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1' }),
  useSocHistory: () => ({ data: [], isLoading: false }),
  useRangeHistory: () => ({ data: [], isLoading: false }),
  usePhantomDrain: () => ({ data: [], isLoading: false }),
  useDegradation: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: any) => <>{children}</> }));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date(), to: new Date() }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));
vi.mock('lucide-react', () => ({
  Battery: () => <svg />, Activity: () => <svg />, Moon: () => <svg />, TrendingDown: () => <svg />,
}));

import { BatteryContent } from '../battery';

it('BatteryContent renders without crashing', () => {
  render(<BatteryContent />);
  expect(screen.getByTestId('soc')).toBeInTheDocument();
  expect(screen.getByTestId('metric-tabs')).toBeInTheDocument();
});
