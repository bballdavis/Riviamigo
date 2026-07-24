import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectedVehicleSuccess } from '../ConnectedVehicleSuccess';

describe('ConnectedVehicleSuccess', () => {
  it('uses the rendered hill line as the vehicle motion path', () => {
    const { container } = render(
      <ConnectedVehicleSuccess vehicleName="Launch Green" onOpenDashboard={() => undefined} />
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
      <ConnectedVehicleSuccess vehicleName="Launch Green" onOpenDashboard={() => undefined} />
    );

    expect(container.querySelector('.rm-success-vehicle-animated')).toBeInTheDocument();
    expect(container.querySelector('.rm-success-vehicle-static')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open dashboard/i })).toBeInTheDocument();
  });
});
