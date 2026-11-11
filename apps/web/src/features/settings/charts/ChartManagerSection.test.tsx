import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartManagerEntry } from '@riviamigo/types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  entries: [] as ChartManagerEntry[],
  refetch: vi.fn(),
  setEnabled: vi.fn(),
  setPlacements: vi.fn(),
  createChart: vi.fn(),
  cloneChart: vi.fn(),
  deleteChart: vi.fn(),
  resetChart: vi.fn(),
  adminSetLock: vi.fn(),
  adminRestore: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useBlocker: () => ({ status: 'idle' }),
}));

vi.mock('@riviamigo/ui/primitives', async () => await import('../../../test/mockPrimitives'));

vi.mock('@riviamigo/dashboards', () => ({
  CHART_SOURCE_MANIFESTS: [{ id: 'vehicle', label: 'Vehicle' }],
  exportChartJson: () => '{}',
  importChartJson: vi.fn(),
  useDashboards: () => ({ data: [{ slug: 'overview', name: 'Overview' }, { slug: 'trips', name: 'Trips' }] }),
}));

vi.mock('@riviamigo/hooks', () => ({
  useChartManager: () => ({ data: mocks.entries, isLoading: false, isError: false, refetch: mocks.refetch }),
  useChartSources: () => ({ data: undefined }),
  useCreateChart: () => ({ mutateAsync: mocks.createChart, isPending: false }),
  useCloneChart: () => ({ mutateAsync: mocks.cloneChart, isPending: false }),
  useDeleteChart: () => ({ mutateAsync: mocks.deleteChart, isPending: false }),
  useResetChart: () => ({ mutateAsync: mocks.resetChart, isPending: false }),
  useSetChartEnabled: () => ({ mutateAsync: mocks.setEnabled, isPending: false }),
  useSetChartPlacements: () => ({ mutateAsync: mocks.setPlacements, isPending: false }),
  useAdminSetChartLock: () => ({ mutateAsync: mocks.adminSetLock, isPending: false }),
  useAdminRestoreChart: () => ({ mutateAsync: mocks.adminRestore, isPending: false }),
}));

import { ChartManagerSection } from './ChartManagerSection';
import { SettingsDraftProvider } from '../drafts/SettingsDraftProvider';

function chartEntry({ id, name, origin = 'override', isEnabled = true, placements = ['overview'] }: {
  id: string;
  name: string;
  origin?: 'system' | 'override' | 'personal';
  isEnabled?: boolean;
  placements?: string[];
}) {
  return {
    effective: {
      id,
      slug: name.toLowerCase(),
      name,
      description: null,
      isEnabled,
      isLocked: false,
      config: {
        series: [],
        sources: [],
        placements: placements.map((dashboardSlug) => ({ dashboardSlug })),
      },
    },
    origin,
    permissions: { delete: true, lock: false, restore: false },
  } as unknown as ChartManagerEntry;
}

function renderSection() {
  return render(
    <SettingsDraftProvider>
      <ChartManagerSection />
    </SettingsDraftProvider>,
  );
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });

describe('ChartManagerSection staged draft', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.entries = [chartEntry({ id: 'chart-1', name: 'Energy' })];
    mocks.refetch.mockResolvedValue({ data: mocks.entries });
    mocks.setEnabled.mockResolvedValue({});
    mocks.setPlacements.mockResolvedValue({});
    mocks.createChart.mockResolvedValue({});
  });

  it('toggling a chart stages it: shows the bar and makes no API call', () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Energy' }));

    expect(bar()).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable Energy' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it('Save applies the changed chart with the same payload as before and clears the bar', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Energy' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith({ id: 'chart-1', isEnabled: false }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Enable Energy' })).toHaveAttribute('aria-checked', 'false');
  });

  it('Discard reverts a staged toggle without calling the API', () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Energy' }));
    fireEvent.click(discardButton());

    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Disable Energy' })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it('Done in the assignments dialog stages placements without an API call; Save sends them', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard assignments for Energy' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Trips/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(mocks.setPlacements).not.toHaveBeenCalled();
    expect(bar()).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.setPlacements).toHaveBeenCalledWith({
      id: 'chart-1',
      placements: [{ dashboardSlug: 'overview' }, { dashboardSlug: 'trips' }],
    }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('Cancel in the assignments dialog discards its picks', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard assignments for Energy' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Trips/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(bar()).not.toBeInTheDocument();
    expect(screen.queryByText('Trips')).not.toBeInTheDocument();
  });

  it('a chart with both an enable change and an assignment change calls each endpoint once', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Energy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit dashboard assignments for Energy' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Trips/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(mocks.setEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.setEnabled).toHaveBeenCalledWith({ id: 'chart-1', isEnabled: false });
    expect(mocks.setPlacements).toHaveBeenCalledTimes(1);
    expect(mocks.setPlacements).toHaveBeenCalledWith({
      id: 'chart-1',
      placements: [{ dashboardSlug: 'overview' }, { dashboardSlug: 'trips' }],
    });
  });

  it('an app-default chart saves through the override create with the same payload as before', async () => {
    mocks.entries = [chartEntry({ id: 'chart-2', name: 'Trips', origin: 'system', placements: [] })];
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Trips' }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.createChart).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'trips',
      name: 'Trips',
      isEnabled: false,
    })));
    expect(mocks.createChart).toHaveBeenCalledTimes(1);
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('a failed save keeps the bar open with a message naming the chart', async () => {
    mocks.setEnabled.mockRejectedValueOnce(new Error('HTTP 500'));
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Energy' }));
    fireEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to update Energy.');
    expect(bar()).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable Energy' })).toHaveAttribute('aria-checked', 'false');
  });
});
