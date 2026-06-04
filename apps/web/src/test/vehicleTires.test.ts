import { describe, expect, it } from 'vitest';

import { formatTireLabel, getTireHealthTone } from '@riviamigo/ui/lib/vehicleTires';

describe('vehicle tire helpers', () => {
  it('matches the configured low-pressure health bands', () => {
    expect(getTireHealthTone({ targetPsi: 48, psi: 46 })).toBe('success');
    expect(getTireHealthTone({ targetPsi: 48, psi: 44 })).toBe('warning');
    expect(getTireHealthTone({ targetPsi: 48, psi: 41 })).toBe('danger');
    expect(getTireHealthTone({ targetPsi: 48, psi: 51 })).toBe('success');
  });

  it('keeps invalid or missing sensors neutral and preserves fallback text', () => {
    expect(getTireHealthTone({ targetPsi: 48, psi: null, status: 'invalid_sensor' })).toBe('neutral');
    expect(getTireHealthTone({ targetPsi: 48, psi: null, status: null })).toBe('neutral');
    expect(formatTireLabel(null, 'invalid_sensor')).toBe('Invalid Sensor');
  });

  it('prefers numeric psi over wheel status when a real reading exists', () => {
    expect(getTireHealthTone({ targetPsi: 48, psi: 46, status: 'warning' })).toBe('success');
    expect(getTireHealthTone({ targetPsi: 48, psi: 46, status: 'low' })).toBe('success');
  });

  it('uses the displayed rounded psi for health so matching visible values match colors', () => {
    expect(getTireHealthTone({ targetPsi: 48, psi: 45.6 })).toBe('success');
    expect(getTireHealthTone({ targetPsi: 48, psi: 46.4 })).toBe('success');
    expect(getTireHealthTone({ targetPsi: 48, psi: 42.6 })).toBe('warning');
    expect(getTireHealthTone({ targetPsi: 48, psi: 42.4 })).toBe('danger');
  });
});
