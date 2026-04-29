import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { vi, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', () => ({
    PageLayout: ({ children, title, actions }) => (_jsxs("div", { "data-testid": "page-layout", children: [_jsx("h1", { children: title }), actions, children] })),
    StatCardGrid: ({ children }) => _jsx("div", { children: children }),
    StatCard: ({ label, value }) => _jsxs("div", { children: [_jsx("span", { children: label }), _jsx("span", { children: value })] }),
    MetricTabs: ({ children, tabs, active, onChange }) => (_jsxs("div", { "data-testid": "metric-tabs", children: [tabs.map((t) => _jsx("button", { onClick: () => onChange(t.key), children: t.label }, t.key)), children] })),
    DateRangePicker: () => _jsx("div", {}),
    StatCardSkeleton: () => _jsx("div", {}),
}));
vi.mock('@riviamigo/ui/charts', () => ({
    SocAreaChart: () => _jsx("div", { "data-testid": "soc" }),
    RangeAreaChart: () => _jsx("div", {}),
    PhantomDrainChart: () => _jsx("div", {}),
    DegradationChart: () => _jsx("div", {}),
}));
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ defaultVehicleId: 'v1' }),
    useSocHistory: () => ({ data: [], isLoading: false }),
    useRangeHistory: () => ({ data: [], isLoading: false }),
    usePhantomDrain: () => ({ data: [], isLoading: false }),
    useDegradation: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../lib/dates', () => ({
    presetToRange: () => ({ from: new Date(), to: new Date() }),
    rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
    DEFAULT_PRESET: '30d',
}));
vi.mock('lucide-react', () => ({
    Battery: () => _jsx("svg", {}), Activity: () => _jsx("svg", {}), Moon: () => _jsx("svg", {}), TrendingDown: () => _jsx("svg", {}),
}));
import { BatteryContent } from '../battery';
it('BatteryContent renders without crashing', () => {
    render(_jsx(BatteryContent, {}));
    expect(screen.getByTestId('soc')).toBeInTheDocument();
    expect(screen.getByTestId('metric-tabs')).toBeInTheDocument();
});
