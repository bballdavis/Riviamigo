import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
vi.mock('@riviamigo/ui/tables', () => ({
    tripColumns: [],
    DataTable: ({ data, emptyTitle, onRowClick }) => (_jsx("div", { "data-testid": "trips-table", children: data.length === 0 ? (_jsx("span", { children: emptyTitle })) : (data.map((row) => (_jsxs("button", { onClick: () => onRowClick?.({ original: row }), children: ["Open ", row.id] }, row.id)))) })),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useTrips: () => ({
        data: {
            items: [
                {
                    id: 'trip-1',
                    started_at: '2024-01-01T12:00:00Z',
                    ended_at: '2024-01-01T13:00:00Z',
                    distance_mi: 18.3,
                    energy_used_kwh: 6.5,
                    efficiency_wh_mi: 355,
                },
            ],
            total: 26,
            page: 1,
            per_page: 25,
        },
        isLoading: false,
    }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
import { TripsContent } from '../trips';
describe('Trips page', () => {
    it('renders the trip count subtitle and pagination controls', () => {
        render(_jsx(TripsContent, {}));
        expect(screen.getByText('Trips')).toBeInTheDocument();
        expect(screen.getByText('26 trips')).toBeInTheDocument();
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    });
    it('navigates to trip detail when a row is selected', () => {
        render(_jsx(TripsContent, {}));
        fireEvent.click(screen.getByRole('button', { name: 'Open trip-1' }));
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/trips/$tripId', params: { tripId: 'trip-1' } });
    });
});
