import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CurrentVehicleStatePanel } from '../components/dashboard/DashboardPage';

const images = {
  all: [
    { placement: 'overhead', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/overhead-light.webp' },
  ],
  overhead: {
    light: '/rivian/overhead-light.webp',
  },
};

describe('dashboard tire health', () => {
  it('colors tire borders from the saved target pressure', () => {
    render(
      <CurrentVehicleStatePanel
        images={images}
        targetTirePressurePsi={48}
        status={{
          vehicle_id: 'vehicle-1',
          battery_level: 80,
          range_miles: 250,
          power_state: 'ready',
          charger_state: 'Disconnected',
          speed_mph: 0,
          latitude: null,
          longitude: null,
          is_online: true,
          last_updated: '2026-06-03T12:00:00Z',
          tire_fl_psi: 46,
          tire_fr_psi: 44,
          tire_rl_psi: 41,
          tire_rr_psi: 51,
        }}
      />,
    );

    expect(screen.getByText('46 psi')).toHaveClass('border-status-positive/70');
    expect(screen.getByText('44 psi')).toHaveClass('border-status-warning/70');
    expect(screen.getByText('41 psi')).toHaveClass('border-status-danger/70');
    expect(screen.getByText('51 psi')).toHaveClass('border-status-positive/70');
  });

  it('keeps invalid sensors neutral', () => {
    render(
      <CurrentVehicleStatePanel
        images={images}
        targetTirePressurePsi={48}
        status={{
          vehicle_id: 'vehicle-1',
          battery_level: 80,
          range_miles: 250,
          power_state: 'ready',
          charger_state: 'Disconnected',
          speed_mph: 0,
          latitude: null,
          longitude: null,
          is_online: true,
          last_updated: '2026-06-03T12:00:00Z',
          tire_fl_psi: null,
          tire_fl_status: 'invalid_sensor',
        }}
      />,
    );

    expect(screen.getByText('Invalid Sensor')).toHaveClass('border-border');
  });

  it('shows a threshold legend tooltip for tire health', async () => {
    render(
      <CurrentVehicleStatePanel
        images={images}
        targetTirePressurePsi={48}
        status={{
          vehicle_id: 'vehicle-1',
          battery_level: 80,
          range_miles: 250,
          power_state: 'ready',
          charger_state: 'Disconnected',
          speed_mph: 0,
          latitude: null,
          longitude: null,
          is_online: true,
          last_updated: '2026-06-03T12:00:00Z',
          tire_fl_psi: 46,
        }}
      />,
    );

    fireEvent.mouseEnter(screen.getByText('46 psi'));

    expect(await screen.findByText('Tire Pressure Health')).toBeInTheDocument();
    expect(screen.getByText('Target: 48 psi')).toBeInTheDocument();
    expect(screen.getByText('46+ psi')).toBeInTheDocument();
    expect(screen.getByText('43-45 psi')).toBeInTheDocument();
    expect(screen.getByText('<=42 psi')).toBeInTheDocument();
  });
});
