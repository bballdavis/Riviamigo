import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: () => ({ status: 'idle' }),
}));

import { SettingsDraftProvider, useSettingsDraft } from './SettingsDraftProvider';
import { useStagedValue } from './useStagedValue';

/** A draft whose saved value can change underneath it, like an optimistic cache write. */
function Field({ saved, onSave }: { saved: string; onSave: (value: string) => Promise<void> }) {
  const staged = useStagedValue(saved);
  useSettingsDraft('field', {
    isDirty: staged.isDirty,
    save: async () => {
      const submitted = staged.value;
      await onSave(submitted);
      staged.commit(submitted, submitted);
    },
    discard: staged.reset,
  });
  return <input aria-label="Value" value={staged.value} onChange={(event) => staged.setValue(event.target.value)} />;
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

describe('SettingsDraftProvider', () => {
  it('runs one save at a time, ignoring repeated Cmd+S and clicks while saving', async () => {
    let release: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<SettingsDraftProvider><Field saved="a" onSave={onSave} /></SettingsDraftProvider>);
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'b' } });

    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true, repeat: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('keeps the draft and shows the error when a save fails, even if the saved value moved meanwhile', async () => {
    let fail: (error: Error) => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const { rerender } = render(<SettingsDraftProvider><Field saved="a" onSave={onSave} /></SettingsDraftProvider>);
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // An optimistic write makes the server value match the edit mid-save...
    rerender(<SettingsDraftProvider><Field saved="b" onSave={onSave} /></SettingsDraftProvider>);
    expect(bar()).toBeInTheDocument();
    // ...and is rolled back when the request fails.
    rerender(<SettingsDraftProvider><Field saved="a" onSave={onSave} /></SettingsDraftProvider>);
    await act(async () => { fail(new Error('Could not be saved. Try again.')); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not be saved. Try again.');
    expect(screen.getByLabelText('Value')).toHaveValue('b');
    expect(bar()).toBeInTheDocument();
  });

  it('does not bring the bar back when a save finishes before the refetch lands', async () => {
    const onSave = vi.fn(async () => {});
    render(<SettingsDraftProvider><Field saved="a" onSave={onSave} /></SettingsDraftProvider>);
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    // The saved prop is still the stale "a" here; the draft must stay clean.
    await act(async () => {});
    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveValue('b');
  });
});
