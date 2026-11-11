import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDraftProvider } from '../../../features/settings/drafts/SettingsDraftProvider';

const apiMocks = vi.hoisted(() => ({
  getExternalConnections: vi.fn(),
  listPlaces: vi.fn(),
  searchPlaceAddresses: vi.fn(),
  createPlace: vi.fn(),
  updatePlace: vi.fn(),
  deletePlace: vi.fn(),
  invalidateChargingData: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({ api: apiMocks, invalidateChargingData: apiMocks.invalidateChargingData }));
vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));
vi.mock('lucide-react', () => ({
  HelpCircle: () => <svg />,
  Home: () => <svg />,
  Loader2: () => <svg />,
  Pencil: () => <svg />,
  Plus: () => <svg />,
  Save: () => <svg />,
  Search: () => <svg />,
  Zap: () => <svg />,
  Trash2: () => <svg />,
}));

import { PlacesSection } from '../PlacesSection';

const address = {
  display_name: '123 Main St, Austin, TX', osm_id: 42, latitude: 30.27, longitude: -97.74,
  road: 'Main St', city: 'Austin', state: 'TX', postcode: '78701', country: 'US', raw: null,
};
const suggestion = { ...address, display_name: '123 Main Street, Austin, TX', osm_id: 43 };
const place = {
  id: 'place-1', name: 'Home charger', latitude: 30.27, longitude: -97.74, radius_m: 76,
  is_home: true, is_work: false, address,
  charging: { id: 'charge-1', name: 'Home charger', billing_type: 'per_kwh' as const, rate: 0.2, session_fee: 1, currency: 'USD', timezone: null, tou_periods: [] },
};

function tree(unitSystem: 'metric' | 'imperial', client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <SettingsDraftProvider>
        <PlacesSection unitSystem={unitSystem} />
      </SettingsDraftProvider>
    </QueryClientProvider>
  );
}

function renderSection(unitSystem: 'metric' | 'imperial' = 'metric') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(tree(unitSystem, client)) };
}

function bar() {
  return screen.queryByRole('region', { name: 'Unsaved changes' });
}

describe('PlacesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getExternalConnections.mockResolvedValue({ connections: [] });
    apiMocks.listPlaces.mockResolvedValue([]);
    apiMocks.searchPlaceAddresses.mockResolvedValue([suggestion]);
    apiMocks.createPlace.mockResolvedValue(place);
    apiMocks.updatePlace.mockResolvedValue(place);
    apiMocks.deletePlace.mockResolvedValue(undefined);
  });

  it('renders an empty saved-places state and unit-specific defaults without a bar', async () => {
    renderSection('imperial');
    expect(await screen.findByText(/No saved places yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Radius (ft)')).toHaveValue('250');
    expect(bar()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Place' })).not.toBeInTheDocument();
  });

  it('searches, selects an address, and creates a place with per-kWh pricing from the bar', async () => {
    renderSection();
    fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText(suggestion.display_name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /123 Main Street/ }));
    fireEvent.change(screen.getByPlaceholderText('Home garage'), { target: { value: 'Downtown' } });
    fireEvent.click(screen.getByRole('button', { name: /Charging Rates/ }));
    fireEvent.change(screen.getByLabelText('Rate ($/kWh)'), { target: { value: '0.25' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1.5' } });
    expect(apiMocks.createPlace).not.toHaveBeenCalled();
    expect(bar()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.createPlace).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Downtown', radius_m: 75, is_home: false, is_work: false, address: suggestion,
      charging: { billing_type: 'per_kwh', rate: 0.25, session_fee: 1.5, currency: 'USD' },
    })));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('Home garage')).toHaveValue('');
  });

  it('blocks a save without a name and keeps the bar open with the message', async () => {
    renderSection();
    fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    fireEvent.click(await screen.findByRole('button', { name: /123 Main Street/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a place name.');
    expect(apiMocks.createPlace).not.toHaveBeenCalled();
    expect(bar()).toBeInTheDocument();
  });

  it('keeps the bar open with the API message when the save fails', async () => {
    apiMocks.createPlace.mockRejectedValueOnce(new Error('Address service unavailable'));
    renderSection();
    fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    fireEvent.click(await screen.findByRole('button', { name: /123 Main Street/ }));
    fireEvent.change(screen.getByPlaceholderText('Home garage'), { target: { value: 'Downtown' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Address service unavailable');
    expect(bar()).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Home garage')).toHaveValue('Downtown');
  });

  it('clears a selected address when its search text changes', async () => {
    renderSection();
    fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    fireEvent.click(await screen.findByRole('button', { name: /123 Main Street/ }));
    expect(screen.getByText('Selected Address')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter an address'), { target: { value: 'different address' } });
    expect(screen.queryByText('Selected Address')).not.toBeInTheDocument();
    expect(bar()).toBeInTheDocument();
  });

  it('validates and edits a TOU schedule, including add and remove period controls', async () => {
    apiMocks.listPlaces.mockResolvedValue([place]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Place' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pricing type'), { target: { value: 'tou' } });
    expect(screen.getByText(/full day in the selected timezone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Period' }));
    expect(screen.getAllByPlaceholderText('Peak')).toHaveLength(2);
    fireEvent.change(screen.getAllByPlaceholderText('Peak')[0]!, { target: { value: 'Night' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    expect(screen.getAllByPlaceholderText('Peak')).toHaveLength(1);
    fireEvent.change(screen.getByDisplayValue('Home charger'), { target: { value: 'Edited home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMocks.updatePlace).toHaveBeenCalledWith('place-1', expect.objectContaining({ name: 'Edited home', charging: expect.objectContaining({ billing_type: 'tou', tou_periods: [{ label: 'Night', start_minute: 0, end_minute: 1440, rate: 0.2 }] }) })));
  });

  it('stages edits to the open place and Discard restores the saved values', async () => {
    apiMocks.listPlaces.mockResolvedValue([place]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    fireEvent.change(screen.getByDisplayValue('Home charger'), { target: { value: 'Renamed' } });
    expect(bar()).toBeInTheDocument();
    expect(apiMocks.updatePlace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByDisplayValue('Home charger')).toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
    expect(apiMocks.updatePlace).not.toHaveBeenCalled();
  });

  it('asks before opening another place while the open place has unsaved changes', async () => {
    const second = { ...place, id: 'place-2', name: 'Office', is_home: false, is_work: true };
    apiMocks.listPlaces.mockResolvedValue([place, second]);
    renderSection();
    const [firstEdit, secondEdit] = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(firstEdit!);
    fireEvent.change(screen.getByDisplayValue('Home charger'), { target: { value: 'Renamed' } });

    fireEvent.click(secondEdit!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Save your changes?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByDisplayValue('Renamed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(screen.getByDisplayValue('Office')).toBeInTheDocument();
    expect(apiMocks.updatePlace).not.toHaveBeenCalled();
  });

  it('keeps Delete immediate while the open place has unsaved changes', async () => {
    const second = { ...place, id: 'place-2', name: 'Office', is_home: false, is_work: true };
    apiMocks.listPlaces.mockResolvedValue([place, second]);
    renderSection();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    fireEvent.change(screen.getByDisplayValue('Home charger'), { target: { value: 'Renamed' } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);

    await waitFor(() => expect(apiMocks.deletePlace).toHaveBeenCalledWith('place-2'));
    expect(bar()).toBeInTheDocument();
  });

  it('filters saved places by address fields and deletes a place', async () => {
    const second = { ...place, id: 'place-2', name: 'Office', is_home: false, is_work: true, address: { ...address, city: 'Dallas' } };
    apiMocks.listPlaces.mockResolvedValue([place, second]);
    renderSection();
    expect(await screen.findByText('Home charger')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search saved places'), { target: { value: 'dallas' } });
    expect(screen.queryByText('Home charger')).not.toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiMocks.deletePlace).toHaveBeenCalledWith('place-2'));
  });

  it('uses custom autocomplete while typing and supports Enter submission', async () => {
    apiMocks.getExternalConnections.mockResolvedValue({ connections: [{ id: 'nominatim', mode: 'custom', custom_autocomplete: true }] });
    renderSection();
    const input = screen.getByPlaceholderText('Enter an address');
    fireEvent.change(input, { target: { value: 'Austin' } });
    await waitFor(() => expect(apiMocks.searchPlaceAddresses).toHaveBeenCalledWith('Austin', 5), { timeout: 1000 });
    expect(await screen.findByText(suggestion.display_name)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Austin TX' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(apiMocks.searchPlaceAddresses).toHaveBeenCalledWith('Austin TX', 5));
  });

  it('converts radius when switching units and resets an edited draft', async () => {
    apiMocks.listPlaces.mockResolvedValue([place]);
    const view = renderSection('metric');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Home charger')).toBeInTheDocument();
    view.rerender(tree('imperial', view.client));
    expect(screen.getByLabelText('Radius (ft)')).toHaveValue('249');
    expect(bar()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New Place' }));
    expect(screen.getByRole('heading', { name: 'Places' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Home garage')).toHaveValue('');
  });

  it('keeps a converted radius on the bar when the user had already edited the place', async () => {
    apiMocks.listPlaces.mockResolvedValue([place]);
    const view = renderSection('metric');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByDisplayValue('Home charger'), { target: { value: 'Renamed' } });

    view.rerender(tree('imperial', view.client));

    expect(screen.getByDisplayValue('Renamed')).toBeInTheDocument();
    expect(screen.getByLabelText('Radius (ft)')).toHaveValue('249');
    expect(bar()).toBeInTheDocument();
  });

  it('shows TOU validation for malformed, unlabeled, non-contiguous, and negative periods', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /Charging Rates/ }));
    fireEvent.change(screen.getByLabelText('Pricing type'), { target: { value: 'tou' } });
    const labels = screen.getAllByPlaceholderText('Peak');
    fireEvent.change(labels[0]!, { target: { value: ' ' } });
    expect(screen.getByText('Each TOU period needs a label.')).toBeInTheDocument();
    fireEvent.change(labels[0]!, { target: { value: 'Period' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.13')[0]!, { target: { value: '-1' } });
    expect(screen.getByText('Each TOU period needs a non-negative rate.')).toBeInTheDocument();
    fireEvent.change(screen.getAllByPlaceholderText('0.13')[0]!, { target: { value: 'bad' } });
    expect(screen.getByText('Each TOU period needs a valid start, end, and rate.')).toBeInTheDocument();
  });

  it('syncs adjacent TOU period starts and exposes the full-day validation message', async () => {
    apiMocks.listPlaces.mockResolvedValue([{ ...place, charging: null }]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: /Charging Rates/ }));
    fireEvent.change(screen.getByLabelText('Pricing type'), { target: { value: 'tou' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Period' }));
    const times = screen.getAllByPlaceholderText('00:00');
    expect(times[1]).toHaveValue('12:00');
    fireEvent.change(screen.getAllByDisplayValue('12:00')[0]!, { target: { value: '11:00' } });
    expect(screen.getAllByDisplayValue('11:00')).toHaveLength(2);
    fireEvent.change(screen.getAllByDisplayValue('11:00')[1]!, { target: { value: '12:00' } });
    fireEvent.change(screen.getAllByPlaceholderText('Peak')[0]!, { target: { value: 'Day' } });
    expect(screen.getByText(/TOU periods must be contiguous/)).toBeInTheDocument();
  });
});
