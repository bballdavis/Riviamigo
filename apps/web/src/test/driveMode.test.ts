import { describe, expect, it } from 'vitest';
import { formatDriveMode, getDriveModeBadgeClass } from '@riviamigo/ui/lib/driveMode';

describe('drive mode formatting', () => {
  it('normalizes friendly drive mode labels from spaced and hyphenated input', () => {
    expect(formatDriveMode('all purpose')).toBe('All-Purpose');
    expect(formatDriveMode('all-purpose')).toBe('All-Purpose');
    expect(getDriveModeBadgeClass('all purpose')).toBe(getDriveModeBadgeClass('all_purpose'));
  });
});