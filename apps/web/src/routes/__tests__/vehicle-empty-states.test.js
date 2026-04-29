import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
        useParams: () => ({ tripId: 'trip-1', sessionId: 'session-1' }),
        useSearch: () => ({}),
    };
});
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatKwh: (v) => `${v} kWh`,
    formatDuration: (s) => `${s}s`,
    formatCurrency: (v) => `$${v}`,
    formatPercent: (v) => `${v}%`,
    formatMiles: (v) => `${v} mi`,
    cn: (...args) => args.filter(Boolean).join(' '),
}));
vi.mock('@riviamigo/ui/charts', () => ({
    TripMapChart: () => _jsx("div", { "data-testid": "trip-map-chart" }),
    SpeedProfileChart: () => _jsx("div", { "data-testid": "speed-chart" }),
    ElevationProfileChart: () => _jsx("div", { "data-testid": "elevation-chart" }),
    ChargeCurveChart: () => _jsx("div", { "data-testid": "charge-curve-chart" }),
}));
vi.mock('@riviamigo/ui/tables', () => ({
    DataTable: () => _jsx("div", { "data-testid": "data-table" }),
    chargingColumns: [],
    tripColumns: [],
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: null, accessToken: null }),
    useVehicles: () => ({ data: [] }),
    useChargeSession: () => ({ data: undefined, isLoading: false }),
    useChargeCurve: () => ({ data: undefined, isLoading: false }),
    useTrip: () => ({ data: undefined, isLoading: false }),
    useTripTrack: () => ({ data: undefined, isLoading: false }),
    useSpeedProfile: () => ({ data: undefined, isLoading: false }),
    useElevationProfile: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({
    AppLayout: ({ children }) => _jsx(_Fragment, { children: children }),
}));
vi.mock('../../components/layout/AuthGuard', () => ({
    AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }),
}));
vi.mock('../../components/layout/NoVehicleState', () => ({
    NoVehicleState: () => (_jsxs("div", { children: [_jsx("p", { children: "No vehicle connected" }), _jsx("button", { children: "Connect Rivian" })] })),
}));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
const emptyConfig = {
    schemaVersion: 1,
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'dashboard',
    name: 'Dashboard',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [],
};
vi.mock('@riviamigo/dashboards', () => ({
    DashboardRenderer: () => _jsx("div", { "data-testid": "dashboard-renderer" }),
    useDashboardBySlug: () => ({ data: emptyConfig, isLoading: false }),
    useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
    useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
    getDefaultBySlug: () => emptyConfig,
    downloadDashboardYaml: vi.fn(),
    importDashboardYaml: vi.fn(),
}));
import { DashboardPage } from '../../components/dashboard/DashboardPage';
import { ChargeSessionContent } from '../charging.$sessionId';
import { TripDetailContent } from '../trips.$tripId';
describe('vehicle empty states', () => {
    it.each([
        ['Battery', _jsx(DashboardPage, { navKey: "battery", slug: "battery", title: "Battery" })],
        ['Charging', _jsx(DashboardPage, { navKey: "charging", slug: "charging", title: "Charging" })],
        ['Efficiency', _jsx(DashboardPage, { navKey: "efficiency", slug: "efficiency", title: "Efficiency" })],
        ['Trips', _jsx(DashboardPage, { navKey: "trips", slug: "trips", title: "Trips" })],
    ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
        render(view);
        expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
    });
    it.each([
        ['ChargeSessionContent', _jsx(ChargeSessionContent, {})],
        ['TripDetailContent', _jsx(TripDetailContent, {})],
    ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
        render(view);
        expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
    });
});
