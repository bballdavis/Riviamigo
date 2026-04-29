import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
    const m = await import('../../test/mockPrimitives');
    return m;
});
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('@riviamigo/ui/charts', () => ({
    EnergyBarChart: () => _jsx("div", { "data-testid": "energy-chart" }),
}));
vi.mock('@riviamigo/ui/tables', () => ({
    DataTable: ({ emptyTitle }) => _jsx("div", { "data-testid": "sessions-table", children: emptyTitle }),
    chargingColumns: [],
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'v1' }),
    useChargeSessions: () => ({
        data: { items: [], total: 0, page: 1, per_page: 25 },
        isLoading: false,
    }),
    useChargingSummary: () => ({
        data: { total_energy_kwh: 120.5, session_count: 8, total_cost_usd: 18.50, weekly: [] },
    }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatKwh: (v) => `${v.toFixed(1)} kWh`,
    formatCurrency: (v) => `$${v.toFixed(2)}`,
}));
import { ChargingContent } from '../charging';
describe('Charging page', () => {
    it('renders all four stat card labels', () => {
        render(_jsx(ChargingContent, {}));
        expect(screen.getByText('Total Energy')).toBeInTheDocument();
        // "Sessions" also appears as a tab button; use getAllByText
        expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
        expect(screen.getByText('Total Cost')).toBeInTheDocument();
        expect(screen.getByText('Avg Session')).toBeInTheDocument();
    });
    it('shows session count from summary data', () => {
        render(_jsx(ChargingContent, {}));
        // session_count: 8
        expect(screen.getByText('8')).toBeInTheDocument();
    });
    it('shows sessions table by default', () => {
        render(_jsx(ChargingContent, {}));
        expect(screen.getByTestId('sessions-table')).toBeInTheDocument();
        expect(screen.queryByTestId('energy-chart')).not.toBeInTheDocument();
    });
    it('switches to energy chart when Energy tab clicked', () => {
        render(_jsx(ChargingContent, {}));
        fireEvent.click(screen.getByRole('button', { name: 'Energy' }));
        expect(screen.getByTestId('energy-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('sessions-table')).not.toBeInTheDocument();
    });
    it('switches back to sessions table', () => {
        render(_jsx(ChargingContent, {}));
        fireEvent.click(screen.getByRole('button', { name: 'Energy' }));
        fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
        expect(screen.getByTestId('sessions-table')).toBeInTheDocument();
    });
    it('renders both tab labels', () => {
        render(_jsx(ChargingContent, {}));
        expect(screen.getByRole('button', { name: 'Sessions' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Energy' })).toBeInTheDocument();
    });
    it('shows empty state message from DataTable', () => {
        render(_jsx(ChargingContent, {}));
        expect(screen.getByText('No charging sessions')).toBeInTheDocument();
    });
});
