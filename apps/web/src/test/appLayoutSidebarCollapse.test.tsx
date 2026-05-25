import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../components/layout/AppLayout';

const navigate = vi.fn();
const logout = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({
    accessToken: 'token',
    defaultVehicleId: 'vehicle-1',
    logout,
  }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicleStatus: () => ({
    status: null,
    connected: true,
    connectionState: 'connected',
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
});
