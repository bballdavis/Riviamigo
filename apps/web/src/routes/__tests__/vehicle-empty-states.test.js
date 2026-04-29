import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
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
    };
});
vi.mock('@riviamigo/ui/charts', () => ({
    SocAreaChart: () => _jsx("div", { "data-testid": "soc-chart" }),
    RangeAreaChart: () => _jsx("div", { "data-testid": "range-chart" }),
    PhantomDrainChart: () => _jsx("div", { "data-testid": "drain-chart" }),
    DegradationChart: () => _jsx("div", { "data-testid": "degrad-chart" }),
    EnergyBarChart: () => _jsx("div", { "data-testid": "energy-chart" }),
    EfficiencyChart: () => _jsx("div", { "data-testid": "mode-chart" }),
    EfficiencyTrendChart: () => _jsx("div", { "data-testid": "trend-chart" }),
    EfficiencyVsTempChart: () => _jsx("div", { "data-testid": "temp-chart" }),
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
    useSummaryStats: () => ({ data: undefined, isLoading: false }),
    useSocHistory: () => ({ data: undefined, isLoading: false }),
    useRangeHistory: () => ({ data: undefined, isLoading: false }),
    usePhantomDrain: () => ({ data: undefined, isLoading: false }),
    useDegradation: () => ({ data: undefined, isLoading: false }),
    useChargeSessions: () => ({ data: undefined, isLoading: false }),
    useChargingSummary: () => ({ data: undefined, isLoading: false }),
    useEfficiencySummary: () => ({ data: undefined, isLoading: false }),
    useEfficiencyByMode: () => ({ data: undefined, isLoading: false }),
    useEfficiencyTrend: () => ({ data: undefined, isLoading: false }),
    useEfficiencyVsTemp: () => ({ data: undefined, isLoading: false }),
    useTrips: () => ({ data: undefined, isLoading: false }),
    useTrip: () => ({ data: undefined, isLoading: false }),
    useTripTrack: () => ({ data: undefined, isLoading: false }),
    useSpeedProfile: () => ({ data: undefined, isLoading: false }),
    useElevationProfile: () => ({ data: undefined, isLoading: false }),
    useChargeSession: () => ({ data: undefined, isLoading: false }),
    useChargeCurve: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({
    AppLayout: ({ children }) => _jsx(_Fragment, { children: children }),
}));
vi.mock('../../components/layout/AuthGuard', () => ({
    AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }),
}));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
    formatMiles: (v) => `${v} mi`,
    formatKwh: (v) => `${v} kWh`,
    formatCurrency: (v) => `$${v}`,
    formatPercent: (v) => `${v}%`,
    formatDuration: (v) => `${v} min`,
}));
import { BatteryContent } from '../battery';
import { ChargingContent } from '../charging';
import { ChargeSessionContent } from '../charging.$sessionId';
import { EfficiencyContent } from '../efficiency';
import { TripsContent } from '../trips';
import { TripDetailContent } from '../trips.$tripId';
describe('vehicle empty states', () => {
    it.each([
        ['BatteryContent', _jsx(BatteryContent, {})],
        ['ChargingContent', _jsx(ChargingContent, {})],
        ['ChargeSessionContent', _jsx(ChargeSessionContent, {})],
        ['EfficiencyContent', _jsx(EfficiencyContent, {})],
        ['TripsContent', _jsx(TripsContent, {})],
        ['TripDetailContent', _jsx(TripDetailContent, {})],
    ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
        render(view);
        expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
    });
});
