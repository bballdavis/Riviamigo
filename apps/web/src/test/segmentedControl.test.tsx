import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../../../../packages/ui/src/primitives/SegmentedControl';

const OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'free', label: 'Free' },
  { value: 'manual', label: 'Manual' },
] as const;

describe('SegmentedControl', () => {
  it('marks only the selected option with the accent border and tint', () => {
    render(<SegmentedControl label="Cost" value="free" options={[...OPTIONS]} onChange={() => {}} />);

    const selected = screen.getByRole('button', { name: 'Free' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected.className).toContain('border-accent');
    expect(selected.className).toContain('bg-accent/10');

    const other = screen.getByRole('button', { name: 'Automatic' });
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other.className).toContain('border-transparent');
    expect(other.className).not.toContain('border-accent');
  });

  it('reports the chosen value and spreads options evenly when full width', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Cost" value="auto" options={[...OPTIONS]} onChange={onChange} fullWidth />);

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    expect(onChange).toHaveBeenCalledWith('manual');
    expect(screen.getByRole('group', { name: 'Cost' })).toHaveStyle({
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    });
  });
});
