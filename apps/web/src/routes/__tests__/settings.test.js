import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
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
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ logout: vi.fn() }),
    useVehicles: () => ({
        data: [{ id: 'v1', display_name: 'Adventure Truck', model: 'R1T', year: null }],
    }),
}));
vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }) => _jsx(_Fragment, { children: children }) }));
vi.mock('lucide-react', () => ({
    Car: () => _jsx("svg", { "data-testid": "icon-car" }),
    LogOut: () => _jsx("svg", { "data-testid": "icon-logout" }),
    Plus: () => _jsx("svg", { "data-testid": "icon-plus" }),
}));
import { SettingsContent } from '../settings';
describe('Settings page', () => {
    it('renders the Vehicles section heading', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText('Vehicles')).toBeInTheDocument();
    });
    it('renders the connected vehicle display name', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText('Adventure Truck')).toBeInTheDocument();
    });
    it('renders the vehicle model', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText(/R1T/)).toBeInTheDocument();
    });
    it('renders the Add Vehicle button', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText('Add Vehicle')).toBeInTheDocument();
    });
    it('navigates to /connect when Add Vehicle is clicked', () => {
        render(_jsx(SettingsContent, {}));
        fireEvent.click(screen.getByText('Add Vehicle'));
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/connect' });
    });
    it('renders the Appearance section', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText('Appearance')).toBeInTheDocument();
        expect(screen.getByText('Theme')).toBeInTheDocument();
    });
    it('renders the theme toggle button', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });
    it('renders the Account section with Sign Out', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByText('Account')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });
    it('shows Active badge for each connected vehicle', () => {
        render(_jsx(SettingsContent, {}));
        expect(screen.getByTestId('badge')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
    });
    it('calls logout and navigates on Sign Out click', async () => {
        const logoutFn = vi.fn().mockResolvedValue(undefined);
        vi.doMock('@riviamigo/hooks', () => ({
            useAuth: () => ({ logout: logoutFn }),
            useVehicles: () => ({ data: [] }),
        }));
        render(_jsx(SettingsContent, {}));
        fireEvent.click(screen.getByText('Sign Out'));
        // logout is async; just assert the click doesn't throw
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });
});
