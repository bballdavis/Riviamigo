import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateRangePicker } from '@riviamigo/ui/primitives';

describe('DateRangePicker', () => {
  it('toggles the custom editor from the preset list', async () => {
    const user = userEvent.setup();

    render(
      <DateRangePicker
        timeframe={{ kind: 'preset', preset: '30d' }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Custom range')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /last 30 days/i }));
    await user.click(screen.getByRole('button', { name: 'Custom Range' }));
    expect(screen.getByText('Custom range')).toBeInTheDocument();
    expect(screen.getAllByText('mm/dd/yyyy')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Custom Range' }));
    expect(screen.queryByText('Custom range')).not.toBeInTheDocument();
  });

  it('applies typed custom dates and keeps the calendar synced', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateRangePicker
        timeframe={{
          kind: 'custom',
          from: new Date(2026, 5, 3, 10, 0),
          to: new Date(2026, 5, 7, 18, 30),
        }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /jun 3, 2026 10:00 am - jun 7, 2026 6:30 pm/i }));

    const fromInput = screen.getByDisplayValue('6/3/26') as HTMLInputElement;
    const toInput = screen.getByDisplayValue('6/7/26') as HTMLInputElement;

    expect(fromInput).toHaveClass('w-full');
    expect(fromInput).toHaveClass('min-w-0');

    const minuteSelects = screen.getAllByRole('combobox').filter((select) => (select as HTMLSelectElement).options.length === 4);
    expect(minuteSelects).toHaveLength(2);
    expect(Array.from((minuteSelects[0] as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['00', '15', '30', '45']);

    await user.clear(fromInput);
    await user.type(fromInput, '7/5/26');

    await waitFor(() => expect(screen.getByLabelText('Month')).toHaveValue('6'));
    expect(fromInput).toHaveValue('7/5/26');

    await user.clear(toInput);
    await user.type(toInput, '7/8/26');
    await waitFor(() => expect(screen.getByLabelText('Month')).toHaveValue('6'));
    expect(toInput).toHaveValue('7/8/26');

    await user.click(screen.getByRole('button', { name: /apply custom range/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'custom',
        from: expect.any(Date),
        to: expect.any(Date),
      }),
    );
  });

  it('applies lifetime directly from the preset list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DateRangePicker
        timeframe={{ kind: 'preset', preset: '30d' }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /last 30 days/i }));
    await user.click(screen.getByRole('button', { name: 'Lifetime' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'lifetime' });
  });
});
