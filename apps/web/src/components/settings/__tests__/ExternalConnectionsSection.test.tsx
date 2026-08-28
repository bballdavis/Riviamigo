import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalConnectionsResponse } from '@riviamigo/types';

const apiMocks = vi.hoisted(() => ({
  getExternalConnections: vi.fn(),
  updateExternalConnection: vi.fn(),
  testExternalConnection: vi.fn(),
  purgeExternalConnectionCache: vi.fn(),
  disableOptionalExternalConnections: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  api: apiMocks,
  BASEMAP_CONFIG_QUERY_KEY: ['external', 'basemap', 'config', 'v1'],
}));

import { ExternalConnectionsSection } from '../ExternalConnectionsSection';

function response(canManage: boolean): ExternalConnectionsResponse {
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
  return { client, ...render(<QueryClientProvider client={client}><ExternalConnectionsSection /></QueryClientProvider>) };
}

function basemapResponse(overrides: Partial<ExternalConnectionsResponse['connections'][number]> = {}) {
  const data = response(true);
  const connection = data.connections[0]!;
  Object.assign(connection, {
    id: 'basemap',
    name: 'Map basemap',
    mode: 'remote',
    has_api_key: true,
    light_url_template: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    dark_url_template: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    ...overrides,
  });
  return data;
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

  it('does not refresh basemap config after a non-basemap save', async () => {
    const data = response(true);
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.updateExternalConnection.mockResolvedValue(data);
    const { client } = renderSection();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.updateExternalConnection).toHaveBeenCalledWith('open_meteo', expect.any(Object)));
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['external', 'basemap', 'config', 'v1'] });
  });

  it('refreshes basemap config after administrators add a write-only CARTO Basemap key', async () => {
    const data = response(true);
    const connection = data.connections[0]!;
    connection.id = 'basemap';
    connection.name = 'Map basemap';
    connection.mode = 'remote';
    connection.light_url_template = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
    connection.dark_url_template = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.updateExternalConnection.mockResolvedValue(data);
    const { client } = renderSection();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    const apiKey = await screen.findByLabelText('CARTO Basemap key');
    fireEvent.change(apiKey, { target: { value: 'carto-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.updateExternalConnection).toHaveBeenCalledWith('basemap', expect.objectContaining({
      api_key: 'carto-secret',
      mode: 'remote',
    })));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['external', 'basemap', 'config', 'v1'] });
  });

  it('shows a not-verified indicator when a saved key has no current test', async () => {
    apiMocks.getExternalConnections.mockResolvedValue(basemapResponse());
    renderSection();

    expect((await screen.findAllByText('Not verified')).length).toBeGreaterThan(0);
  });

  it('shows a verified indicator after a current successful key test', async () => {
    apiMocks.getExternalConnections.mockResolvedValue(basemapResponse({
      last_test_at: '2026-07-14T12:01:00Z',
      last_test_ok: true,
    }));
    renderSection();

    expect(await screen.findByText('Key verified')).toBeInTheDocument();
  });

  it('shows a rejected indicator after a current unauthorized key test', async () => {
    apiMocks.getExternalConnections.mockResolvedValue(basemapResponse({
      last_test_at: '2026-07-14T12:01:00Z',
      last_test_ok: false,
      last_test_error: 'HTTP 401 Unauthorized',
    }));
    renderSection();

    expect(await screen.findByText('Key rejected')).toBeInTheDocument();
  });

  it('treats a test from before the key was saved as not verified', async () => {
    apiMocks.getExternalConnections.mockResolvedValue(basemapResponse({
      updated_at: '2026-07-14T12:02:00Z',
      last_test_at: '2026-07-14T12:01:00Z',
      last_test_ok: true,
    }));
    renderSection();

    expect((await screen.findAllByText('Not verified')).length).toBeGreaterThan(0);
  });

  it('verifies a saved basemap key and refreshes the persisted indicator', async () => {
    const data = basemapResponse();
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.testExternalConnection.mockResolvedValue({ checks: [{ label: 'Basemap', message: 'OK' }], preview_data_url: null });
    const { client } = renderSection();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    expect((await screen.findAllByText('Not verified')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Test with synthetic data' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify key' }));

    await waitFor(() => expect(apiMocks.testExternalConnection).toHaveBeenCalledWith('basemap', expect.objectContaining({ mode: 'remote' })));
    expect(apiMocks.testExternalConnection.mock.calls[0]?.[1]).not.toHaveProperty('api_key');
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['external-connections'] }));
  });

  it('lets administrators explicitly clear a stored CARTO Basemap key', async () => {
    const data = response(true);
    const connection = data.connections[0]!;
    connection.id = 'basemap';
    connection.name = 'Map basemap';
    connection.mode = 'remote';
    connection.has_api_key = true;
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.updateExternalConnection.mockResolvedValue(data);
    renderSection();

    expect(screen.queryByLabelText('CARTO Basemap key')).not.toBeInTheDocument();
    expect(await screen.findByText('Key saved')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear stored CARTO Basemap key' }));
    expect(screen.getByText(/Clear the saved key/)).toBeInTheDocument();
    expect(apiMocks.updateExternalConnection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear key' }));

    await waitFor(() => expect(apiMocks.updateExternalConnection).toHaveBeenCalledWith('basemap', expect.objectContaining({ clear_api_key: true })));
  });

  it('reveals a replacement field from the saved-key state without rendering the secret', async () => {
    const data = response(true);
    const connection = data.connections[0]!;
    connection.id = 'basemap';
    connection.name = 'Map basemap';
    connection.mode = 'remote';
    connection.has_api_key = true;
    apiMocks.getExternalConnections.mockResolvedValue(data);
    apiMocks.updateExternalConnection.mockResolvedValue(data);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Replace stored CARTO Basemap key' }));
    const replacement = await screen.findByLabelText('Replace CARTO Basemap key');
    expect(screen.queryByRole('button', { name: 'Clear stored CARTO Basemap key' })).not.toBeInTheDocument();
    fireEvent.change(replacement, { target: { value: 'carto-replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.updateExternalConnection).toHaveBeenCalledWith('basemap', expect.objectContaining({ api_key: 'carto-replacement', clear_api_key: false })));
    expect(screen.queryByDisplayValue('carto-replacement')).not.toBeInTheDocument();
    expect(screen.queryByText('carto-replacement')).not.toBeInTheDocument();
  });
});
