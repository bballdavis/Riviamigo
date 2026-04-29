import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
    const m = await import('../../test/mockPrimitives');
    return m;
});
vi.mock('@riviamigo/ui/charts', () => ({
    SocAreaChart: () => _jsx("div", { "data-testid": "soc-chart" }),
    EfficiencyTrendChart: () => _jsx("div", { "data-testid": "efficiency-chart" }),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useSummaryStats: () => ({
        data: {
            total_miles: 1234,
            total_trips: 42,
            total_energy_kwh: 456.7,
            avg_efficiency_wh_mi: 318,
            total_charge_sessions: 8,
            total_cost_usd: 12.5,
        },
        isLoading: false,
    }),
    useSocHistory: () => ({ data: [{ ts: '2024-01-01T00:00:00Z', soc: 79 }], isLoading: false }),
    useEfficiencyTrend: () => ({ data: [{ day: '2024-01-01', day_avg_wh_mi: 320, rolling_7d_wh_mi: 315 }], isLoading: false }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', display_name: 'Forest R1S' }] }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx("div", { "data-testid": "app-layout", children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatMiles: (v) => `${v} mi`,
    formatKwh: (v) => `${v} kWh`,
}));
import { indexRoute } from '../index';
const DashboardContent = indexRoute.options.component;
describe('Dashboard page', () => {
    it('renders the vehicle subtitle and summary stat labels', () => {
        render(_jsx(DashboardContent, {}));
        expect(screen.getByTestId('app-layout')).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Forest R1S')).toBeInTheDocument();
        expect(screen.getByText('Total Miles')).toBeInTheDocument();
        expect(screen.getByText('Total Trips')).toBeInTheDocument();
        expect(screen.getByText('Energy Charged')).toBeInTheDocument();
        expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    });
    it('shows the SoC chart by default and switches to efficiency trend', () => {
        render(_jsx(DashboardContent, {}));
        expect(screen.getByTestId('soc-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('efficiency-chart')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Efficiency Trend' }));
        expect(screen.getByTestId('efficiency-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('soc-chart')).not.toBeInTheDocument();
    });
});
