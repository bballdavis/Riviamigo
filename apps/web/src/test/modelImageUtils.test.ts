import { describe, expect, it } from 'vitest';
import { getOpenDoorStates } from '../../../../packages/dashboards/src/widgets/custom/imageUtils';
import type { VehicleStatus } from '@riviamigo/types';

describe('model image utils', () => {
  it('includes truck-specific closures when open', () => {
    const status = {
      door_front_left_closed: true,
      door_front_right_closed: true,
      door_rear_left_closed: true,
      door_rear_right_closed: true,
      closure_frunk_closed: true,
      closure_liftgate_closed: true,
      closure_tailgate_closed: true,
      tonneau_closed: false,
      side_bin_left_closed: false,
      side_bin_right_closed: false,
    } as Partial<VehicleStatus> as VehicleStatus;

    const open = getOpenDoorStates(status);
    expect(open).toContain('tonneau');
    expect(open).toContain('side_bin_left');
    expect(open).toContain('side_bin_right');
  });
});
