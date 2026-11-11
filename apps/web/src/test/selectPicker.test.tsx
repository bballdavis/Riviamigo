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

  describe('searchable', () => {
    const options = [
      { value: 'odometer', label: 'Odometer', group: 'Vehicle state' },
      { value: 'speed', label: 'Speed', group: 'Vehicle state' },
      { value: 'battery_health_pct', label: 'Battery Health', group: 'Battery health', keywords: 'soh degradation' },
      { value: 'charging_total_cost', label: 'Total Cost', group: 'Charging' },
    ];

    it('groups options under headings and focuses the search box', async () => {
      const user = userEvent.setup();
      render(<SelectPicker searchable value="speed" onChange={() => undefined} aria-label="Stat" options={options} />);

      await user.click(screen.getByRole('button', { name: 'Stat' }));

      expect(screen.getByRole('searchbox', { name: 'Search Stat' })).toHaveFocus();
      expect(screen.getByText('Vehicle state')).toBeInTheDocument();
      expect(screen.getByText('Battery health')).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('filters on label, keywords and value, requiring every term', async () => {
      const user = userEvent.setup();
      render(<SelectPicker searchable value="speed" onChange={() => undefined} aria-label="Stat" options={options} />);
      await user.click(screen.getByRole('button', { name: 'Stat' }));
      const search = screen.getByRole('searchbox');

      await user.type(search, 'degradation');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Battery Health']);

      await user.clear(search);
      await user.type(search, 'total cost');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Total Cost']);

      await user.clear(search);
      await user.type(search, 'zzz');
      expect(screen.queryAllByRole('option')).toHaveLength(0);
      expect(screen.getByText('No matches')).toBeInTheDocument();
    });

    it('selects the first match on Enter and moves into the list with the arrow keys', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<SelectPicker searchable value="speed" onChange={onChange} aria-label="Stat" options={options} />);

      await user.click(screen.getByRole('button', { name: 'Stat' }));
      await user.type(screen.getByRole('searchbox'), 'o');
      await user.keyboard('{ArrowDown}');
      expect(screen.getAllByRole('option')[0]).toHaveFocus();

      await user.click(screen.getByRole('searchbox'));
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith('odometer');
    });

    it('shows the selected label even while the list is filtered, and resets the search on reopen', async () => {
      const user = userEvent.setup();
      render(<SelectPicker searchable value="speed" onChange={() => undefined} aria-label="Stat" options={options} />);
      const trigger = screen.getByRole('button', { name: 'Stat' });

      await user.click(trigger);
      await user.type(screen.getByRole('searchbox'), 'cost');
      expect(trigger).toHaveTextContent('Speed');

      await user.keyboard('{Escape}');
      await user.click(trigger);
      expect(screen.getByRole('searchbox')).toHaveValue('');
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('has no search box unless asked for', async () => {
      const user = userEvent.setup();
      render(<SelectPicker value="speed" onChange={() => undefined} aria-label="Stat" options={options} />);
      await user.click(screen.getByRole('button', { name: 'Stat' }));
      expect(screen.queryByRole('searchbox')).toBeNull();
    });
  });
});
