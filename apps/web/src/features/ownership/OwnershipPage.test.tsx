import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnershipResponse } from '@riviamigo/types';
import { response } from './testFixtures';

const ownership = vi.hoisted(() => ({ data: undefined as OwnershipResponse | undefined }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@riviamigo/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riviamigo/hooks')>()),
  useOwnership: () => ({ data: ownership.data, isLoading: false, isError: false }),
  useUpdateOwnershipSettings: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
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
});
