import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  getExternalConnections: vi.fn(),
  updateExternalConnection: vi.fn(),
  testExternalConnection: vi.fn(),
  purgeExternalConnectionCache: vi.fn(),
  disableOptionalExternalConnections: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({ api: apiMocks }));

import { ExternalConnectionsSection } from '../ExternalConnectionsSection';

function response(canManage: boolean) {
  return {
    can_manage: canManage,
    connections: [{
      id: 'open_meteo',
      name: 'Open-Meteo weather',
      purpose: 'Estimated outside temperature along completed drives.',
      data_shared: ['Rounded drive coordinates by default', 'Drive date'],
      disabled_effect: 'No new estimated exterior temperatures; stored history remains.',
      execution: 'Server',
      privacy_url: 'https://open-meteo.com/en/terms',
      terms_url: 'https://open-meteo.com/en/terms',
      editable: canManage,
      enabled: true,
      mode: 'remote',
      endpoint: 'https://api.open-meteo.com/v1/forecast',
      endpoint_is_private: false,
      weather_precision: 'approximate',
      forecast_url: 'https://api.open-meteo.com/v1/forecast',
      archive_url: 'https://archive-api.open-meteo.com/v1/archive',
      base_url: null,
      light_url_template: null,
      dark_url_template: null,
      attribution: 'Weather data by Open-Meteo',
      attribution_url: 'https://open-meteo.com/',
      request_identifier: null,
      custom_autocomplete: false,
      allow_private_network: false,
      has_api_key: false,
      has_bearer_token: false,
      updated_at: '2026-07-14T12:00:00Z',
      last_attempt_at: null,
      last_success_at: null,
      last_error: null,
      last_test_at: null,
      last_test_ok: null,
      last_test_error: null,
      cache: {
        entries: 24,
        bytes: 4096,
        persistent: true,
        purgeable: true,
        description: 'Persistent address search results and reverse-geocoded addresses.',
      },
      request_count_today: 12,
    }],
  };
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ExternalConnectionsSection /></QueryClientProvider>);
}

describe('ExternalConnectionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows disclosures and feature loss without controls to read-only users', async () => {
    apiMocks.getExternalConnections.mockResolvedValue(response(false));
    renderSection();

    expect((await screen.findAllByText('Open-Meteo weather')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rounded drive coordinates by default/)).toBeInTheDocument();
    expect(screen.getByText(/No new estimated exterior temperatures/)).toBeInTheDocument();
    expect(screen.getByText(/administrator controls the installation policy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('confirms and disables optional connections for administrators', async () => {
    const initial = response(true);
    const disabled = { ...initial, connections: initial.connections.map((item) => ({ ...item, enabled: false, mode: 'disabled' })) };
    apiMocks.getExternalConnections.mockResolvedValue(initial);
    apiMocks.disableOptionalExternalConnections.mockResolvedValue(disabled);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Disable optional' }));
    await waitFor(() => expect(apiMocks.disableOptionalExternalConnections).toHaveBeenCalledTimes(1));
  });

  it('shows persistent cache usage and lets administrators purge it', async () => {
    const data = response(true);
    const connection = data.connections[0]!;
    connection.id = 'nominatim';
    connection.name = 'OpenStreetMap Nominatim';
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.purgeExternalConnectionCache.mockResolvedValue({ purged_entries: 24, message: 'Persistent cache purged.' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();

    expect(await screen.findByText(/24 entries/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Purge cache' }));
    await waitFor(() => expect(apiMocks.purgeExternalConnectionCache).toHaveBeenCalledWith('nominatim'));
  });
});
