import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SelectPicker } from '@riviamigo/ui/primitives';

describe('SelectPicker', () => {
  it('opens a rich listbox and reports the selected option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SelectPicker
        value="r1s"
        onChange={onChange}
        aria-label="Vehicle"
        options={[
          { value: 'r1s', label: 'R1S', description: 'Adventure SUV' },
          { value: 'r1t', label: 'R1T', description: 'Adventure truck' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Vehicle' }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /R1S Adventure SUV/i })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('option', { name: /R1T Adventure truck/i }));
    expect(onChange).toHaveBeenCalledWith('r1t');
  });
});
