import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupOverview } from '@riviamigo/types';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));
const { getOverview, updateSettings, testS3, runNow } = vi.hoisted(() => ({
  getOverview: vi.fn(),
  updateSettings: vi.fn(),
  testS3: vi.fn(),
  runNow: vi.fn(),
}));
vi.mock('@riviamigo/hooks', () => ({
  api: {
    getBackupOverview: getOverview,
    updateBackupSettings: updateSettings,
    testBackupS3: testS3,
    runBackupNow: runNow,
  },
  queryKeys: {
    backups: {
      all: ['backups'],
      overview: (page: number, perPage: number) => ['backups', 'overview', page, perPage],
    },
  },
}));
import { SettingsDraftProvider } from '../../../features/settings/drafts/SettingsDraftProvider';
import { BackupSection } from '../BackupSection';

const UNSAVED = 'You have unsaved changes';

function buildOverview(settingsPatch: Partial<BackupOverview['settings']> = {}): BackupOverview {
  return {
    settings: {
      enabled: true,
      frequency: 'weekly',
      run_at: '03:00',
      timezone: 'America/Chicago',
      day_of_week: 0,
      day_of_month: null,
      retention_count: 8,
      local_enabled: true,
      s3_enabled: true,
      target_type: 's3',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'riviamigo-backups',
      prefix: 'prod/riviamigo',
      access_key: 'backup-user',
      has_secret_key: true,
      updated_at: '2026-05-04T12:00:00Z',
      ...settingsPatch,
    },
    recent_runs: [],
    recent_runs_total: 0,
    recent_runs_page: 1,
    recent_runs_per_page: 10,
    artifacts: [],
    restore_requests: [],
    latest_successful_run: null,
    next_run_at: null,
    runtime_readiness: {
      pg_dump_available: true,
      run_now_allowed: true,
      restore_automation_available: true,
      reason: null,
    },
    s3_catalog_error: null,
  };
}

const basePayload = {
  enabled: true,
  frequency: 'weekly',
  run_at: '03:00',
  timezone: 'America/Chicago',
  day_of_week: 0,
  day_of_month: null,
  retention_count: 8,
  local_enabled: true,
  s3_enabled: true,
  target_type: 's3',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'riviamigo-backups',
  prefix: 'prod/riviamigo',
  access_key: 'backup-user',
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SettingsDraftProvider>
          <BackupSection />
        </SettingsDraftProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getOverview.mockResolvedValue(buildOverview());
  updateSettings.mockResolvedValue({});
  testS3.mockResolvedValue({ ok: true, message: 'S3 list/write/read/delete checks passed' });
  runNow.mockResolvedValue({});
});

describe('BackupSection', () => {
  it('stages schedule edits behind the page save bar and saves the same payload as before', async () => {
    const user = userEvent.setup();
    renderSection();
    const retention = await screen.findByLabelText('Retention count');
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();

    await user.clear(retention);
    await user.type(retention, '12');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    getOverview.mockResolvedValue(buildOverview({ retention_count: 12 }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith({ ...basePayload, retention_count: 12 });
    await waitFor(() => expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Retention count')).toHaveValue(12);
  });

  it('discard reverts staged schedule edits without saving', async () => {
    const user = userEvent.setup();
    renderSection();
    const retention = await screen.findByLabelText('Retention count');
    await user.clear(retention);
    await user.type(retention, '3');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Retention count')).toHaveValue(8);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('shows save-time validation in the bar and does not call the API', async () => {
    const user = userEvent.setup();
    renderSection();
    const retention = await screen.findByLabelText('Retention count');
    await user.clear(retention);
    await user.type(retention, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retention must be a whole number greater than zero.',
    );
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('stages a typed S3 secret until Save and sends it with the payload', async () => {
    const user = userEvent.setup();
    renderSection();
    const secret = await screen.findByPlaceholderText('Saved secret is unchanged');
    await user.type(secret, 'new-secret');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith({ ...basePayload, secret_key: 'new-secret' });
    await waitFor(() => expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument());
  });

  it('sends the clear-secret flag only when it is pending at save time', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('checkbox', { name: /clear the saved secret/i }));
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith({ ...basePayload, clear_secret_key: true });
  });

  it('runs the S3 connection test against the staged draft without saving it', async () => {
    const user = userEvent.setup();
    renderSection();
    const bucket = await screen.findByLabelText('Bucket');
    await user.clear(bucket);
    await user.type(bucket, 'staged-bucket');

    await user.click(screen.getByRole('button', { name: 'Test S3 connection' }));
    await waitFor(() =>
      expect(testS3).toHaveBeenCalledWith({ ...basePayload, bucket: 'staged-bucket' }),
    );
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('keeps Run now immediate and does not save or discard staged edits', async () => {
    const user = userEvent.setup();
    renderSection();
    const retention = await screen.findByLabelText('Retention count');
    await user.clear(retention);
    await user.type(retention, '12');

    await user.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(1));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('keeps staged edits when the overview refetches while the form is dirty', async () => {
    const user = userEvent.setup();
    const { client } = renderSection();
    const retention = await screen.findByLabelText('Retention count');
    await user.clear(retention);
    await user.type(retention, '12');

    getOverview.mockResolvedValue(buildOverview({ retention_count: 4, updated_at: '2026-05-05T12:00:00Z' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['backups'] });
    });
    await waitFor(() => expect(screen.getByText('4 sets')).toBeInTheDocument());
    expect(screen.getByLabelText('Retention count')).toHaveValue(12);
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('follows server data while the form is clean', async () => {
    const { client } = renderSection();
    expect(await screen.findByLabelText('Retention count')).toHaveValue(8);

    getOverview.mockResolvedValue(buildOverview({ retention_count: 4, updated_at: '2026-05-05T12:00:00Z' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['backups'] });
    });
    await waitFor(() => expect(screen.getByLabelText('Retention count')).toHaveValue(4));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });
});
