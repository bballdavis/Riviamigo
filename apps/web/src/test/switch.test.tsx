import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '@riviamigo/ui/primitives';

describe('Switch', () => {
  it('exposes switch semantics and toggles from pointer and keyboard activation', () => {
    const onChange = vi.fn();
    const view = render(<Switch checked={false} onChange={onChange} aria-label="Enabled" />);
    const control = screen.getByRole('switch', { name: 'Enabled' });

    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);

    view.rerender(<Switch checked onChange={onChange} aria-label="Enabled" />);
    fireEvent.keyDown(control, { key: ' ' });
    fireEvent.keyUp(control, { key: ' ' });
    fireEvent.click(control);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
