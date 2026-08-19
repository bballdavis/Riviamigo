import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectedVehicleSuccess } from '../ConnectedVehicleSuccess';

const hookMocks = vi.hoisted(() => ({ status: null as Record<string, unknown> | null }));

vi.mock('@riviamigo/hooks', () => ({
  useCurrentVehicleStatus: () => ({ data: hookMocks.status }),
}));

describe('ConnectedVehicleSuccess', () => {
  beforeEach(() => {
    hookMocks.status = null;
  });

  it('uses the rendered hill line as the vehicle motion path', () => {
    const { container } = render(
      <ConnectedVehicleSuccess
        vehicleId="vehicle-1"
        vehicleName="Launch Green"
        onOpenDashboard={() => undefined}
      />
    );

    const hillPath = container.querySelector('path[id^="rm-success-hills-"]');
    const motion = container.querySelector('animateMotion');
    const motionPath = motion?.querySelector('mpath');

    expect(hillPath).toHaveAttribute('stroke', 'var(--rm-accent)');
    expect(motion).toHaveAttribute('dur', '2.2s');
    expect(motion).toHaveAttribute('calcMode', 'paced');
    expect(motion).toHaveAttribute('rotate', 'auto');
    expect(motion).toHaveAttribute('repeatCount', 'indefinite');
    expect(motionPath).toHaveAttribute('href', `#${hillPath?.id}`);
  });

  it('keeps a static vehicle variant available for reduced-motion users', () => {
    const { container } = render(
      <ConnectedVehicleSuccess
        vehicleId="vehicle-1"
        vehicleName="Launch Green"
        onOpenDashboard={() => undefined}
      />
    );

    expect(container.querySelector('.rm-success-vehicle-animated')).toBeInTheDocument();
    expect(container.querySelector('.rm-success-vehicle-static')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('Vehicle saved')).toBeInTheDocument();
    expect(screen.getByText(/sleeping vehicle may take a little while/i)).toBeInTheDocument();
  });

  it('only reports telemetry as available after a collector event', () => {
    hookMocks.status = {
      worker_health: 'connected',
      last_event_at: '2026-08-16T12:00:00Z',
    };

    render(
      <ConnectedVehicleSuccess
        vehicleId="vehicle-1"
        vehicleName="Launch Green"
        onOpenDashboard={() => undefined}
      />
    );

    expect(screen.getByText('Vehicle connected')).toBeInTheDocument();
    expect(screen.getByText(/telemetry is available/i)).toBeInTheDocument();
  });

  it('keeps a saved vehicle successful when collector health needs attention', () => {
    hookMocks.status = { worker_health: 'error' };

    render(
      <ConnectedVehicleSuccess
        vehicleId="vehicle-1"
        vehicleName="Launch Green"
        onOpenDashboard={() => undefined}
      />
    );

    expect(screen.getByText('Vehicle saved')).toBeInTheDocument();
    expect(screen.getByText(/telemetry collector needs attention/i)).toBeInTheDocument();
  });
});
