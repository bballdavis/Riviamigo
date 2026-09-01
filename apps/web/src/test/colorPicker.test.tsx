import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from '@riviamigo/ui/primitives';

function Harness({ onApply }: { onApply: (value: { light: string; dark: string }) => void }) {
  const [open, setOpen] = React.useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open colors</button><ColorPicker open={open} value={{ light: '#fd8304', dark: '#fd8304' }} swatches={[{ id: 'series-01', label: 'Series 1', light: '#112233', dark: '#223344' }, { id: 'series-02', label: 'Series 2', light: '#445566', dark: '#556677' }]} onApply={onApply} onOpenChange={setOpen} /></>;
}

describe('ColorPicker', () => {
  it('authors a linked color and persists canonical hex only on Apply', () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open colors' }));
    const input = screen.getByLabelText('HEX color');
    fireEvent.change(input, { target: { value: '#F80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ light: '#ff8800', dark: '#ff8800' });
  });

  it('supports keyboard swatch navigation and restores focus after Cancel', async () => {
    render(<Harness onApply={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Open colors' });
    trigger.focus();
    fireEvent.click(trigger);
    const first = screen.getByRole('radio', { name: 'Series 1' });
    const second = screen.getByRole('radio', { name: 'Series 2' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Preview #556677')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
