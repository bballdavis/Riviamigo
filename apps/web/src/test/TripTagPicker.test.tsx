import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn(async ({ name }: { name: string }) => ({ id: 'new-tag', name }));

vi.mock('@riviamigo/hooks', () => ({
  useTripTags: () => ({ data: [{ id: 'bike-rack', name: 'Bike Rack', color_token: 'accent' }], isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
  useCreateTripTag: () => ({ mutateAsync: create, isPending: false }),
}));

vi.mock('@riviamigo/ui/tables', () => ({
  TripTagBadge: ({ tag }: { tag: { name: string } }) => <span>{tag.name}</span>,
  formatTripTagName: (value: string) => value.trim().replace(/\s+/g, ' ').replace(/^./, (first) => first.toUpperCase()),
}));

import { deriveCommonTagIds, TripTagPicker } from '../../../../packages/dashboards/src/widgets/table/TripTagPicker';

describe('TripTagPicker', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(async ({ name }: { name: string }) => ({ id: 'new-tag', name }));
  });

  it('cleans stale tags, reports dynamic search results, supports keyboard selection, and lets managers create', async () => {
    const onChange = vi.fn();
    function Harness() {
      const [selected, setSelected] = React.useState(['stale-tag']);
      return <TripTagPicker vehicleId="vehicle-1" canManage selectedIds={selected} onChange={(next) => { onChange(next); setSelected(next); }} />;
    }
    render(<Harness />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(screen.getByRole('button', { name: /filter tags/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /filter tags/i }));
    const search = screen.getByRole('textbox', { name: /search existing tags/i });
    fireEvent.change(search, { target: { value: 'bike' } });
    expect(screen.getByText('1 matching tag')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['bike-rack']);
    fireEvent.change(search, { target: { value: 'Cargo Box' } });
    expect(screen.getByText('0 matching tags')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create “cargo box”/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Cargo Box' }));
  });

  it('keeps the attempted name and shows an actionable error when creation fails', async () => {
    create.mockRejectedValueOnce(new Error('offline'));
    render(<TripTagPicker vehicleId="vehicle-1" canManage selectedIds={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /filter tags/i }));
    const search = screen.getByRole('textbox', { name: /search existing tags/i });
    fireEvent.change(search, { target: { value: 'Cargo Box' } });
    fireEvent.click(screen.getByRole('button', { name: /create “cargo box”/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create this tag');
    expect(search).toHaveValue('Cargo Box');
  });

  it('derives the shared tag intersection without using the union', () => {
    expect(deriveCommonTagIds([
      { tags: [{ id: 'shared' }, { id: 'only-a' }] },
      { tags: [{ id: 'shared' }, { id: 'only-b' }] },
    ])).toEqual(['shared']);
  });

  it('supports inline keyboard adds and chip removal for the selected-trip control', () => {
    const onChange = vi.fn();
    function Harness() {
      const [selected, setSelected] = React.useState<string[]>([]);
      return <TripTagPicker vehicleId="vehicle-1" canManage selectedIds={selected} onChange={(next) => { onChange(next); setSelected(next); }} label="Add tags to selected trips" mode="inline" />;
    }

    render(<Harness />);
    const search = screen.getByRole('textbox', { name: /add tags to selected trips/i });
    const field = search.parentElement;
    expect(field).toHaveClass('focus-within:border-accent');
    expect(field).toHaveClass('focus-within:ring-1');
    fireEvent.change(search, { target: { value: 'bike' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['bike-rack']);
    expect(search).toHaveValue('');
    const removeTag = screen.getByRole('button', { name: 'Remove Bike Rack' });
    expect(removeTag).toBeInTheDocument();
    expect(removeTag).toHaveClass('focus-visible:ring-1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bike Rack' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    fireEvent.change(search, { target: { value: 'bike' } });
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(onChange).toHaveBeenLastCalledWith(['bike-rack']);
    expect(search).toHaveValue('');
  });

  it('shows a mixed-state placeholder while preserving common chips', () => {
    render(<TripTagPicker vehicleId="vehicle-1" canManage selectedIds={['bike-rack']} onChange={vi.fn()} label="Add tags to selected trips" mode="inline" mixed />);

    expect(screen.getByRole('textbox', { name: /add tags to selected trips/i })).toHaveAttribute('placeholder', 'Mixed tags · add or replace');
    expect(screen.getByRole('button', { name: 'Remove Bike Rack' })).toBeInTheDocument();
  });

});
