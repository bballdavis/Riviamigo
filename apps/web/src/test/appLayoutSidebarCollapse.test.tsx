import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../components/layout/AppLayout';

const navigate = vi.fn();
const logout = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: (selector?: (state: { accessToken: string; defaultVehicleId: string; logout: typeof logout }) => unknown) => {
    const state = {
      accessToken: 'token',
      defaultVehicleId: 'vehicle-1',
      logout,
    };
    return selector ? selector(state) : state;
  },
  useResolvedVehicleSelection: () => ({
    effectiveVehicleId: 'vehicle-1',
    vehicleSelectionReady: true,
    vehicles: [{ id: 'vehicle-1', model: 'R1S' }],
  }),
  useMe: () => ({
    data: { role: 'user' },
  }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicleStatus: () => ({
    status: null,
    connected: true,
    connectionState: 'online',
  }),
}));

describe('AppLayout sidebar collapse', () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
    logout.mockClear();
  });

  it('keeps the main content centered inside the current sidebar width', () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    const main = document.querySelector('main.rm-app-main');

    expect(main).toHaveClass('lg:pl-64');
    expect(main).not.toHaveClass('lg:pl-[72px]');

    fireEvent.click(screen.getByLabelText('Collapse sidebar'));

    expect(main).toHaveClass('lg:pl-[72px]');
    expect(main).not.toHaveClass('lg:pl-64');

    fireEvent.click(screen.getByLabelText('Expand sidebar'));

    expect(main).toHaveClass('lg:pl-64');
    expect(main).not.toHaveClass('lg:pl-[72px]');
  });

  it('keeps the sidebar collapsed after navigating from a collapsed nav item', () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    const main = document.querySelector('main.rm-app-main');

    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(main).toHaveClass('lg:pl-[72px]');

    fireEvent.click(screen.getByTitle('Battery'));

    expect(navigate).toHaveBeenCalledWith({ to: '/battery' });
    expect(main).toHaveClass('lg:pl-[72px]');
    expect(localStorage.getItem('rm-sidebar-collapsed')).toBe('true');
  });

  it('uses the full battery icon for the main battery nav item', () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    const batteryButton = screen.getByRole('button', { name: 'Battery' });

    expect(batteryButton.querySelector('[data-nav-icon="battery-full"]')).toBeInTheDocument();
  });

  it('centers the collapsed vehicle status when the battery indicator is unavailable', () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    fireEvent.click(screen.getByLabelText('Collapse sidebar'));

    const statusRow = document.querySelector('[data-collapsed-status-row]');

    expect(statusRow).toHaveClass('justify-center');
    expect(statusRow).not.toHaveClass('grid-cols-[24px_24px]');
  });

  it('shows phantom drain as a battery child item and navigates to it', () => {
    render(
      <AppLayout activeKey="battery.phantom-drain">
        <div>Battery content</div>
      </AppLayout>,
    );

    expect(screen.getByText('Phantom Drain')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Phantom Drain'));

    expect(navigate).toHaveBeenCalledWith({ to: '/battery/phantom-drain' });
  });

  it('does not show battery child nav outside battery section', () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    expect(screen.queryByText('Phantom Drain')).not.toBeInTheDocument();
  });

  it('opens a full-screen mobile navigation sheet with touch-safe destinations and utilities', async () => {
    render(
      <AppLayout activeKey="dashboard">
        <div>Dashboard content</div>
      </AppLayout>,
    );

    const trigger = screen.getByRole('button', { name: 'Toggle navigation' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    const sheetControls = within(sheet);
    const overview = sheetControls.getByRole('button', { name: 'Overview' });
    const battery = sheetControls.getByRole('button', { name: 'Battery' });
    const settings = sheetControls.getByRole('button', { name: 'Open settings' });
    const signOut = sheetControls.getByRole('button', { name: 'Sign out' });

    expect(sheet).toHaveAttribute('data-mobile-navigation', 'true');
    expect(sheet).toHaveClass('inset-0');
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(overview).toHaveClass('min-h-14');
    expect(battery).toHaveClass('min-h-14');
    expect(sheetControls.getByLabelText('Vehicle status: Online').parentElement).toHaveClass('h-12');
    expect(settings).toHaveClass('h-12');
    expect(signOut).toHaveClass('h-12');

    fireEvent.click(battery);

    expect(navigate).toHaveBeenCalledWith({ to: '/battery' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Navigation' })).getByRole('button', { name: 'Open settings' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle navigation' })).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });
});
