import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartColorField } from '@riviamigo/ui/charts';
import { applyThemePreferences } from '@riviamigo/ui/lib/theme';

describe('ChartColorField', () => {
  beforeEach(() => {
    applyThemePreferences({ mode: 'light', palette: 'rad' });
  });

  it('keeps Automatic as the theme default while exposing all 16 accent overrides', () => {
    const onChange = vi.fn();
    const onAutomatic = vi.fn();

    render(
      <ChartColorField
        value={{ mode: 'token', token: 'accent' }}
        automatic={{ active: true, color: 'var(--rm-series-01)', onSelect: onAutomatic }}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Theme accent color' }));
    expect(screen.getAllByRole('option').filter((option) => !option.hasAttribute('disabled'))).toHaveLength(16);
    const accent16 = screen.getByRole('option', { name: /Accent 16 series-16/i });
    expect(accent16.querySelector('[aria-hidden="true"]')).toHaveAttribute('style', expect.stringContaining('--rm-series-16'));

    fireEvent.click(accent16);
    expect(onChange).toHaveBeenCalledWith({ mode: 'token', token: 'series-16' });

    fireEvent.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(onAutomatic).toHaveBeenCalledOnce();
  });

  it('supports arrow-key navigation through accent overrides', () => {
    const onChange = vi.fn();
    render(<ChartColorField value={{ mode: 'token', token: 'series-01' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Theme accent color' }));
    const first = screen.getByRole('option', { name: /Accent 01 series-01/i });
    const second = screen.getByRole('option', { name: /Accent 02 series-02/i });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ mode: 'token', token: 'series-02' });
  });
});
