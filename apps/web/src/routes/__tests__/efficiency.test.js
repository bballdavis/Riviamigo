import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
    const m = await import('../../test/mockPrimitives');
    return m;
});
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => _jsx("div", { children: "connect vehicle" }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
const mockConfig = {
    schemaVersion: 1,
    id: '00000000-0000-0000-0000-000000000003',
    slug: 'efficiency',
    name: 'Efficiency',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [],
};
vi.mock('@riviamigo/dashboards', () => ({
    DashboardRenderer: () => _jsx("div", { "data-testid": "dashboard-renderer" }),
    useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
    useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
    useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
    getDefaultBySlug: () => mockConfig,
    downloadDashboardYaml: vi.fn(),
    importDashboardYaml: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => vi.fn() };
});
import { DashboardPage } from '../../components/dashboard/DashboardPage';
describe('Efficiency dashboard page', () => {
    it('renders the page title', () => {
        render(_jsx(DashboardPage, { navKey: "efficiency", slug: "efficiency", title: "Efficiency" }));
        expect(screen.getByText('Efficiency')).toBeInTheDocument();
    });
    it('renders the dashboard renderer', () => {
        render(_jsx(DashboardPage, { navKey: "efficiency", slug: "efficiency", title: "Efficiency" }));
        expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
    });
});
