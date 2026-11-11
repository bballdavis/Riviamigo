import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDraftProvider } from '../../../features/settings/drafts/SettingsDraftProvider';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));

const hooks = vi.hoisted(() => ({
  role: 'manager' as 'manager' | 'viewer',
  modes: {} as Record<string, 'automatic' | 'free'>,
  mutateAsync: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  useResolvedVehicleSelection: () => ({ authReady: true, vehicleSelectionReady: true, effectiveVehicleId: 'vehicle-1' }),
  useVehicles: () => ({ data: [{ id: 'vehicle-1', membership_role: hooks.role }] }),
  useChargingNetworkPreferences: () => ({
    data: Object.entries(hooks.modes).map(([network_vendor, cost_mode]) => ({ network_vendor, cost_mode, session_count: 3 })),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateChargingNetworkPreference: () => ({ mutateAsync: hooks.mutateAsync, isPending: false, variables: undefined }),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <svg />,
  Save: () => <svg />,
  Trash2: () => <svg />,
  Zap: () => <svg />,
}));

import { ChargingSection } from '../ChargingSection';

const RIVIAN = 'Rivian Adventure Network';

function renderSection() {
  return render(<SettingsDraftProvider><ChargingSection /></SettingsDraftProvider>);
}

describe('ChargingSection', () => {
  beforeEach(() => {
    hooks.role = 'manager';
    hooks.modes = { [RIVIAN]: 'automatic' };
    hooks.mutateAsync.mockReset();
    hooks.mutateAsync.mockImplementation(async ({ networkVendor, costMode }: { networkVendor: string; costMode: 'automatic' | 'free' }) => {
      hooks.modes = { ...hooks.modes, [networkVendor]: costMode };
      return { network_vendor: networkVendor, cost_mode: costMode };
    });
  });

  it('stages a policy change behind the page bar and saves it through the mutation', async () => {
    renderSection();

    expect(screen.getByText(RIVIAN)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
    expect(hooks.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(hooks.mutateAsync).toHaveBeenCalledWith({ networkVendor: RIVIAN, costMode: 'free' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument());
    expect(screen.queryByText(/policy saved/)).not.toBeInTheDocument();
  });

  it('reverts a staged policy when Discard is chosen', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(hooks.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends each changed vendor sequentially and skips unchanged vendors', async () => {
    hooks.modes = { [RIVIAN]: 'automatic', 'Tesla Supercharger': 'automatic', Electrify: 'free', 'Ford Charging': 'automatic' };
    renderSection();

    fireEvent.click(within(screen.getByRole('group', { name: `${RIVIAN} cost policy` })).getByRole('button', { name: 'Free' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Tesla Supercharger cost policy' })).getByRole('button', { name: 'Free' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Electrify cost policy' })).getByRole('button', { name: 'Automatic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(hooks.mutateAsync).toHaveBeenCalledTimes(3));
    expect(hooks.mutateAsync.mock.calls).toEqual([
      [{ networkVendor: RIVIAN, costMode: 'free' }],
      [{ networkVendor: 'Tesla Supercharger', costMode: 'free' }],
      [{ networkVendor: 'Electrify', costMode: 'automatic' }],
    ]);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument());
  });

  it('keeps the bar open with the API message when a save fails', async () => {
    hooks.mutateAsync.mockRejectedValueOnce(new Error('Vehicle is not reachable'));
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vehicle is not reachable Try again.');
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps policies visible but read-only for a viewer', () => {
    hooks.role = 'viewer';
    renderSection();

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Free' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the vehicle owner or a manager/)).toBeInTheDocument();
  });
});
