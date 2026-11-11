import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnershipResponse, OwnershipSettings, Vehicle } from '@riviamigo/types';
import { response } from './testFixtures';

const state = vi.hoisted(() => ({
  enabled: true,
  data: undefined as OwnershipResponse | undefined,
  saved: [] as OwnershipSettings[],
  toggled: [] as boolean[],
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riviamigo/hooks')>()),
  useOwnershipEnabled: () => state.enabled,
  useUpdateOwnershipPreference: () => ({
    mutate: (value: boolean) => state.toggled.push(value),
    isPending: false,
    isError: false,
  }),
  useResolvedVehicleSelection: () => ({ effectiveVehicleId: 'vehicle-1' }),
  useOwnership: () => ({ data: state.data, isLoading: false, isError: false }),
  useUpdateOwnershipSettings: () => ({
    mutate: (settings: OwnershipSettings, options?: { onSuccess?: () => void }) => {
      state.saved.push(settings);
      options?.onSuccess?.();
    },
    reset: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

import { OwnershipSettingsSection } from './OwnershipSettingsSection';

const vehicles = [{ id: 'vehicle-1', display_name: 'R1S', model: 'R1S', is_demo: false }] as Vehicle[];

describe('Settings > Ownership', () => {
  beforeEach(() => {
    state.enabled = true;
    state.data = response();
    state.saved = [];
    state.toggled = [];
  });

  it('groups every Ownership setting into its own section', () => {
    render(<OwnershipSettingsSection vehicles={vehicles} />);
    for (const title of ['Show Ownership', 'Purchase and value', 'Running costs', 'Projection', 'Maintenance schedules']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Purchase price ($)')).toHaveValue('80000');
  });

  it('saves one section without touching the others', async () => {
    render(<OwnershipSettingsSection vehicles={vehicles} />);
    fireEvent.change(screen.getByLabelText('Insurance and other, per month ($)'), { target: { value: '210' } });
    // An unsaved edit in another section must not ride along.
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '99000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save running costs' }));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(state.saved[0]).toMatchObject({ insurance_monthly_usd: 210, purchase_price_usd: 80_000 });
  });

  it('requires a purchase price in the purchase section', () => {
    render(<OwnershipSettingsSection vehicles={vehicles} />);
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save purchase and value' }));
    expect(screen.getByText('Enter what you paid.')).toBeInTheDocument();
    expect(state.saved).toHaveLength(0);
  });

  it('hides every section while Ownership is turned off, and turns it on from the switch', () => {
    state.enabled = false;
    render(<OwnershipSettingsSection vehicles={vehicles} />);
    expect(screen.queryByText('Running costs')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Show Ownership' }));
    expect(state.toggled).toEqual([true]);
  });
});
