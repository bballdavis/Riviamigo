import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
    const m = await import('../../test/mockPrimitives');
    return m;
});
vi.mock('@riviamigo/ui/charts', () => ({
    EfficiencyChart: () => _jsx("div", { "data-testid": "mode-chart" }),
    EfficiencyTrendChart: () => _jsx("div", { "data-testid": "trend-chart" }),
    EfficiencyVsTempChart: () => _jsx("div", { "data-testid": "temp-chart" }),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'v1' }),
    useEfficiencySummary: () => ({
        data: { avg: 320, p10: 260, p90: 400 },
    }),
    useEfficiencyByMode: () => ({ data: [], isLoading: false }),
    useEfficiencyTrend: () => ({ data: [], isLoading: false }),
    useEfficiencyVsTemp: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatMiles: (v) => `${v} mi`,
    formatKwh: (v) => `${v} kWh`,
    formatCurrency: (v) => `$${v}`,
}));
import { EfficiencyContent } from '../efficiency';
describe('Efficiency page', () => {
    it('renders all four stat card labels', () => {
        render(_jsx(EfficiencyContent, {}));
        expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
        expect(screen.getByText('Best 10%')).toBeInTheDocument();
        expect(screen.getByText('Worst 10%')).toBeInTheDocument();
        expect(screen.getByText('Total Miles')).toBeInTheDocument();
    });
    it('renders summary values from hook data', () => {
        render(_jsx(EfficiencyContent, {}));
        expect(screen.getByText('320')).toBeInTheDocument();
    });
    it('shows By Drive Mode chart by default', () => {
        render(_jsx(EfficiencyContent, {}));
        expect(screen.getByTestId('mode-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
    });
    it('switches to Trend chart when Trend tab clicked', () => {
        render(_jsx(EfficiencyContent, {}));
        fireEvent.click(screen.getByText('Trend'));
        expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('mode-chart')).not.toBeInTheDocument();
    });
    it('switches to vs Temperature chart', () => {
        render(_jsx(EfficiencyContent, {}));
        fireEvent.click(screen.getByText('vs Temperature'));
        expect(screen.getByTestId('temp-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('mode-chart')).not.toBeInTheDocument();
    });
    it('renders all three tab labels', () => {
        render(_jsx(EfficiencyContent, {}));
        expect(screen.getByText('By Drive Mode')).toBeInTheDocument();
        expect(screen.getByText('Trend')).toBeInTheDocument();
        expect(screen.getByText('vs Temperature')).toBeInTheDocument();
    });
    it('returns to By Drive Mode tab after switching away', () => {
        render(_jsx(EfficiencyContent, {}));
        fireEvent.click(screen.getByText('Trend'));
        fireEvent.click(screen.getByText('By Drive Mode'));
        expect(screen.getByTestId('mode-chart')).toBeInTheDocument();
    });
});
