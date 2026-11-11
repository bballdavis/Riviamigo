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
  failSave: false,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: () => ({ status: 'idle' }),
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riviamigo/hooks')>()),
  useOwnershipEnabled: () => state.enabled,
  useUpdateOwnershipPreference: () => ({
    mutateAsync: async (value: boolean) => {
      state.toggled.push(value);
      return { ownership_enabled: value };
    },
    isPending: false,
    isError: false,
  }),
  useResolvedVehicleSelection: () => ({ effectiveVehicleId: 'vehicle-1' }),
  useOwnership: () => ({ data: state.data, isLoading: false, isError: false }),
  useUpdateOwnershipSettings: () => ({
    mutateAsync: async (settings: OwnershipSettings) => {
      if (state.failSave) throw new Error('500');
      state.saved.push(settings);
      return settings;
    },
    isPending: false,
    isError: false,
  }),
}));

import { SettingsDraftProvider } from '../settings/drafts/SettingsDraftProvider';
import { OwnershipSettingsSection } from './OwnershipSettingsSection';

const vehicles = [{ id: 'vehicle-1', display_name: 'R1S', model: 'R1S', is_demo: false }] as Vehicle[];

function renderSection() {
  return render(
    <SettingsDraftProvider>
      <OwnershipSettingsSection vehicles={vehicles} />
    </SettingsDraftProvider>,
  );
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

describe('Settings > Ownership', () => {
  beforeEach(() => {
    state.enabled = true;
    state.data = response();
    state.saved = [];
    state.toggled = [];
    state.failSave = false;
  });

  it('groups every Ownership setting into its own section, with no per-section save buttons', () => {
    renderSection();
    for (const title of ['Show Ownership', 'Purchase and value', 'Running costs', 'Projection', 'Maintenance schedules']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Purchase price ($)')).toHaveValue('80000');
    expect(screen.queryByRole('button', { name: /^Save / })).not.toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
  });

  it('stages edits from several sections and saves them in one request', async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('Insurance and other, per month ($)'), { target: { value: '210' } });
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '99000' } });
    expect(bar()).toBeInTheDocument();
    expect(state.saved).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(state.saved[0]).toMatchObject({ insurance_monthly_usd: 210, purchase_price_usd: 99_000 });
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('discards staged edits without saving', async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '99000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByLabelText('Purchase price ($)')).toHaveValue('80000');
    expect(state.saved).toHaveLength(0);
  });

  it('keeps the bar open and shows the field error when a purchase price is missing', async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter what you paid.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Fix the highlighted fields');
    expect(state.saved).toHaveLength(0);
    expect(bar()).toBeInTheDocument();
  });

  it('keeps edits and reports the failure when the server rejects the save', async () => {
    state.failSave = true;
    renderSection();
    fireEvent.change(screen.getByLabelText('Purchase price ($)'), { target: { value: '99000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByLabelText('Purchase price ($)')).toHaveValue('99000');
  });

  it('stages a maintenance item edit and saves it with the cost settings', async () => {
    renderSection();
    const [firstCost] = screen.getAllByLabelText('Cost ($)');
    fireEvent.change(firstCost!, { target: { value: '321' } });
    expect(bar()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    const own = state.saved[0]!.maintenance?.own ?? [];
    expect(own[0]?.cost_usd).toBe(321);
  });

  it('stages the Show Ownership switch and hides the sections only after it is turned off', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Show Ownership' }));
    expect(state.toggled).toEqual([]);
    expect(screen.getByText('Running costs')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.toggled).toEqual([false]));
  });
});
