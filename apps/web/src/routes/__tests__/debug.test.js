import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { vi, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', () => ({
    PageLayout: ({ children, title, actions }) => (_jsxs("div", { "data-testid": "page-layout", children: [_jsx("h1", { children: title }), actions, children] })),
    DateRangePicker: () => _jsx("div", {}),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => _jsx("div", { children: "no vehicle" }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date(), to: new Date() }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
const mockConfig = {
    schemaVersion: 1,
    id: '00000000-0000-0000-0000-000000000002',
    slug: 'battery',
    name: 'Battery',
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
it('DashboardPage renders without crashing', () => {
    render(_jsx(DashboardPage, { navKey: "battery", slug: "battery", title: "Battery" }));
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
    expect(screen.getByTestId('page-layout')).toBeInTheDocument();
});
