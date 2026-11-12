import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResponsiveDialog } from '@riviamigo/ui/primitives';

describe('ResponsiveDialog', () => {
  it('starts focus on the first control when no field asks for it', () => {
    render(
      <ResponsiveDialog titleId="plain-title" onClose={() => {}}>
        <h2 id="plain-title">Plain</h2>
        <button type="button">Close</button>
        <input aria-label="Name" />
      </ResponsiveDialog>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('keeps focus on a field that autofocuses, such as a typed confirmation', () => {
    render(
      <ResponsiveDialog titleId="confirm-title" onClose={() => {}}>
        <h2 id="confirm-title">Confirm</h2>
        <button type="button">Close</button>
        <input aria-label="Type RESTORE to continue" autoFocus />
      </ResponsiveDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type RESTORE to continue')).toHaveFocus();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ResponsiveDialog titleId="escape-title" onClose={onClose}>
        <h2 id="escape-title">Escape</h2>
        <button type="button">Close</button>
      </ResponsiveDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
