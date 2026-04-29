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
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useParams: () => ({ sessionId: 'session-1' }),
    };
});
vi.mock('@riviamigo/ui/charts', () => ({
    ChargeCurveChart: () => _jsx("div", { "data-testid": "charge-curve-chart" }),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useChargeSession: () => ({
        data: {
            id: 'session-1',
            vehicle_id: 'vehicle-1',
            started_at: '2024-01-01T12:00:00Z',
            ended_at: '2024-01-01T13:15:00Z',
            location_name: 'Home Charger',
            charger_type: 'level2',
            energy_added_kwh: 28.5,
            soc_start: 20,
            soc_end: 80,
            peak_power_kw: 11.5,
            cost_usd: 8.75,
            duration_min: 75,
        },
    }),
    useChargeCurve: () => ({ data: [{ soc_pct: 20, power_kw: 11.5 }], isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatKwh: (v) => `${v} kWh`,
    formatDuration: (v) => `${v} min`,
    formatCurrency: (v) => `$${v}`,
    formatPercent: (v) => `${v}%`,
}));
import { ChargeSessionContent } from '../charging.$sessionId';
describe('Charge session detail page', () => {
    it('renders session details and the charge curve chart', () => {
        render(_jsx(ChargeSessionContent, {}));
        expect(screen.getByText('Home Charger')).toBeInTheDocument();
        expect(screen.getByText('Energy Added')).toBeInTheDocument();
        expect(screen.getByText('28.5 kWh')).toBeInTheDocument();
        expect(screen.getByText('SoC')).toBeInTheDocument();
        expect(screen.getByText('20% → 80%')).toBeInTheDocument();
        expect(screen.getByText('Duration')).toBeInTheDocument();
        expect(screen.getByText('75 min')).toBeInTheDocument();
        expect(screen.getByText('Cost')).toBeInTheDocument();
        expect(screen.getByText('$8.75')).toBeInTheDocument();
        expect(screen.getByText('Power vs state of charge')).toBeInTheDocument();
        expect(screen.getByTestId('charge-curve-chart')).toBeInTheDocument();
    });
    it('navigates back to the charging page', () => {
        render(_jsx(ChargeSessionContent, {}));
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging' });
    });
});
