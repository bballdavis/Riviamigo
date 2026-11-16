import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnershipResponse, OwnershipSettings } from '@riviamigo/types';
import { response } from './testFixtures';

const ownership = vi.hoisted(() => ({ data: undefined as OwnershipResponse | undefined }));
const saves = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isError: false,
  /** What the query cache holds right now, which can be newer than the rendered copy. */
  latest: undefined as OwnershipResponse | undefined,
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@riviamigo/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riviamigo/hooks')>()),
  useOwnership: () => ({ data: ownership.data, isLoading: false, isError: false }),
  useUpdateOwnershipSettings: () => ({
    mutate: saves.mutate,
    reset: saves.reset,
    isPending: false,
    isError: saves.isError,
    readLatest: () => saves.latest,
  }),
}));

import { OwnershipDashboard } from './OwnershipPage';

/** A response as an older build saved it, before maintenance schedules and the fast-charging split. */
function cachedBeforeSchedules(data: OwnershipResponse): OwnershipResponse {
  const drop = <T extends object>(value: T, ...keys: string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) as T;
  return {
    ...data,
    settings: drop(data.settings, 'maintenance', 'projection_years'),
    usage: { ...data.usage, months: data.usage.months.map((row) => drop(row, 'fast_kwh', 'fast_priced_kwh', 'fast_cost_usd')) },
    reference_vehicles: data.reference_vehicles.map((vehicle) => drop(vehicle, 'maintenance')),
    own_defaults: drop(data.own_defaults, 'maintenance'),
    class_defaults: {
      ev: drop(data.class_defaults.ev, 'maintenance'),
      hybrid: drop(data.class_defaults.hybrid, 'maintenance'),
      gas: drop(data.class_defaults.gas, 'maintenance'),
    },
  };
}

describe('Ownership dashboard', () => {
  beforeEach(() => {
    ownership.data = undefined;
    saves.mutate.mockReset();
    saves.reset.mockReset();
    saves.isError = false;
    saves.latest = undefined;
  });

  it('renders every section from a current response', () => {
    ownership.data = response();
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);
    for (const title of ['Compare with', 'Money spent over time', 'Where the money goes', 'Cost breakdown', 'Where the numbers come from']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it('renders a response cached by an older build instead of crashing', () => {
    ownership.data = cachedBeforeSchedules(response());
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);
    expect(screen.getByText('Cost breakdown')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it('asks for the purchase price before showing anything else', () => {
    const data = response();
    data.settings.purchase_price_usd = null;
    ownership.data = data;
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);
    expect(screen.getByText('Add what you paid')).toBeInTheDocument();
  });

  it('builds a comparison change from the latest cached settings, not the rendered copy', () => {
    const custom = { id: 'custom-1', label: 'Custom EV', powertrain: 'ev' as const, price_usd: 70_000, mpg: null, kwh_per_mi: 0.3, premium_fuel: false };
    const rendered = response();
    rendered.settings.comparisons = { enabled: null, custom: [custom] };
    ownership.data = rendered;
    // The custom vehicle was removed, and that save has not refetched into the render yet.
    const latest = response();
    latest.settings.comparisons = { enabled: null, custom: [] };
    saves.latest = latest;
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);

    fireEvent.click(screen.getByRole('button', { name: 'Gas SUV' }));

    expect(saves.mutate).toHaveBeenCalledTimes(1);
    const [settings] = saves.mutate.mock.calls[0] as [OwnershipSettings];
    expect(settings.comparisons.custom).toEqual([]);
    expect(settings.comparisons.enabled).not.toContain('custom-1');
    expect(settings.comparisons.enabled).not.toContain('gas_suv');
  });

  it('keeps the selection local for members without edit rights and saves nothing', () => {
    ownership.data = response({ can_edit: false });
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);

    fireEvent.click(screen.getByRole('button', { name: 'Gas SUV' }));

    expect(saves.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Gas SUV' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows an inline error on the page when a comparison save fails', () => {
    ownership.data = response();
    saves.isError = true;
    render(<OwnershipDashboard vehicleId="vehicle-1" ownLabel="R1S" />);

    expect(screen.getByRole('alert')).toHaveTextContent('That change could not be saved.');
  });
});
