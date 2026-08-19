import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));

const hooks = vi.hoisted(() => ({
  role: 'manager' as 'manager' | 'viewer',
  mutate: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  useResolvedVehicleSelection: () => ({ authReady: true, vehicleSelectionReady: true, effectiveVehicleId: 'vehicle-1' }),
  useVehicles: () => ({ data: [{ id: 'vehicle-1', membership_role: hooks.role }] }),
  useChargingNetworkPreferences: () => ({
    data: [{ network_vendor: 'Rivian Adventure Network', cost_mode: 'automatic', session_count: 3 }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateChargingNetworkPreference: () => ({ mutate: hooks.mutate, isPending: false, isError: false }),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <svg />,
  Zap: () => <svg />,
}));

import { ChargingSection } from '../ChargingSection';

describe('ChargingSection', () => {
  it('shows observed networks and updates their free policy for a manager', () => {
    hooks.role = 'manager';
    hooks.mutate.mockClear();
    render(<ChargingSection />);

    expect(screen.getByText('Rivian Adventure Network')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    expect(hooks.mutate).toHaveBeenCalledWith(
      { networkVendor: 'Rivian Adventure Network', costMode: 'free' },
      expect.any(Object),
    );
  });

  it('keeps policies visible but read-only for a viewer', () => {
    hooks.role = 'viewer';
    render(<ChargingSection />);

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Free' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the vehicle owner or a manager/)).toBeInTheDocument();
  });
});
