import { describe, expect, it } from 'vitest';
import { ownershipLabelError } from './ownershipLabels';

describe('ownershipLabelError', () => {
  it('accepts a trimmed name within the limit', () => {
    expect(ownershipLabelError('  Model Y  ', 80)).toBeNull();
  });

  it('rejects empty and over-long names', () => {
    expect(ownershipLabelError('   ', 80)).toMatch(/1 to 80/);
    expect(ownershipLabelError('x'.repeat(61), 60)).toMatch(/1 to 60/);
  });

  it('counts characters, not UTF-16 units, like the API', () => {
    expect(ownershipLabelError('🚙'.repeat(60), 60)).toBeNull();
  });

  it('rejects inner control characters but trims surrounding whitespace', () => {
    expect(ownershipLabelError('Oil\tchange', 60)).toMatch(/control characters/);
    expect(ownershipLabelError('Tires\u0085', 60)).toMatch(/control characters/);
    expect(ownershipLabelError('Brakes\n', 60)).toBeNull();
  });
});
