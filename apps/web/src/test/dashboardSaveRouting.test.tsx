/**
 * Tests for the create-vs-update routing logic in createDefaultDashboardEditActions.
 *
 * Three scenarios must always work:
 *   1. savedConfig shows an owned copy  → PUT (updateDashboard) called directly, no POST
 *   2. savedConfig shows no owned copy  → POST (createDashboard) for first-time save
 *   3. POST fails (stale cache)         → refetch then PUT fallback succeeds
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { canManageSystemDashboards, createDefaultDashboardEditActions } from '../components/dashboard/DashboardPage';
import type { DashboardPageShellRenderState } from '../components/dashboard/DashboardPageShell';
import type { DashboardConfig } from '@riviamigo/dashboards';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SYSTEM_DEFAULT_ID = '00000000-0000-0000-0000-000000000002';
const USER_COPY_ID      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID           = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const systemDefault: DashboardConfig = {
  schemaVersion: 2,
  id: SYSTEM_DEFAULT_ID,
  slug: 'battery',
  name: 'Battery',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

const userCopy: DashboardConfig = {
  ...systemDefault,
  id: USER_COPY_ID,
  isDefault: false,
  isLocked: false,
  ownerId: USER_ID,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeShellState(overrides: Partial<DashboardPageShellRenderState>): DashboardPageShellRenderState {
  return {
    activeConfig: undefined,
    savedConfig: undefined,
    localConfig: null,
    setLocalConfig: vi.fn(),
    isEditMode: true,
    isLoading: false,
    vehicleId: null,
    ctx: { vehicleId: null, from: '', to: '' },
    range: { from: new Date('2024-01-01'), to: new Date('2024-01-31') },
    preset: undefined,
    setRange: vi.fn(),
    setPreset: vi.fn(),
    enterEdit: vi.fn(),
    exitEdit: vi.fn(),
    ...overrides,
  };
}

type QcMock = {
  refetchQueries: ReturnType<typeof vi.fn>;
  getQueryData: ReturnType<typeof vi.fn>;
  invalidateQueries: ReturnType<typeof vi.fn>;
};

function setup(
  shellState: DashboardPageShellRenderState,
  mutations: {
    updateMock: ReturnType<typeof vi.fn>;
    createMock: ReturnType<typeof vi.fn>;
    adminUpdateMock?: ReturnType<typeof vi.fn>;
    qcMock: QcMock;
    isAdmin?: boolean;
  },
) {
  const { updateMock, createMock, adminUpdateMock, qcMock, isAdmin = false } = mutations;

  const renderFn = createDefaultDashboardEditActions({
    updateDashboard: { mutateAsync: updateMock, isPending: false } as never,
    updateAdminDashboard: { mutateAsync: adminUpdateMock ?? vi.fn(), isPending: false } as never,
    createDashboard: { mutateAsync: createMock, isPending: false } as never,
    qc: qcMock as never,
    isAdmin,
  });

  render(<>{renderFn(shellState)}</>);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createDefaultDashboardEditActions — save routing', () => {
  let updateMock: ReturnType<typeof vi.fn>;
  let createMock: ReturnType<typeof vi.fn>;
  let qcMock: QcMock;

  beforeEach(() => {
    updateMock = vi.fn().mockResolvedValue(userCopy);
    createMock = vi.fn().mockResolvedValue(userCopy);
    qcMock = {
      refetchQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn().mockReturnValue(undefined),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('calls updateDashboard with the owned copy id when savedConfig has ownerId set', async () => {
    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: userCopy, localConfig: systemDefault, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_COPY_ID, ownerId: USER_ID, isDefault: false, isLocked: false }),
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('never fires a POST when savedConfig already shows an owned copy', async () => {
    setup(
      makeShellState({ savedConfig: userCopy, localConfig: systemDefault }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    // Only PUT — the 422 POST+fallback cycle must not happen
    expect(createMock).not.toHaveBeenCalled();
  });

  it('uses the dashboard list cache to avoid a stale by-slug POST+422 save', async () => {
    qcMock.getQueryData.mockImplementation((queryKey) => {
      return JSON.stringify(queryKey) === JSON.stringify(['dashboards']) ? [userCopy] : undefined;
    });

    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: systemDefault }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_COPY_ID, ownerId: USER_ID, isDefault: false, isLocked: false }),
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('calls createDashboard for a genuine first-time save (no owned copy in cache)', async () => {
    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: systemDefault, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'battery', isDefault: false, isLocked: false }),
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('falls back to updateDashboard via refetch when createDashboard fails (stale cache scenario)', async () => {
    createMock.mockRejectedValue(new Error('A dashboard with that slug already exists'));
    qcMock.getQueryData.mockImplementation((queryKey) => {
      return JSON.stringify(queryKey) === JSON.stringify(['dashboards', 'slug', 'battery']) ? userCopy : undefined;
    });

    const exitEdit = vi.fn();
    // savedConfig shows system default (stale) even though user already has a copy
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: systemDefault, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(createMock).toHaveBeenCalled();
    expect(qcMock.refetchQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['dashboards', 'slug', 'battery'] }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_COPY_ID, ownerId: USER_ID }),
    );
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('falls back through the dashboard list when a failed create leaves by-slug stale', async () => {
    createMock.mockRejectedValue(new Error('A dashboard with that slug already exists'));
    let dashboardListReads = 0;
    qcMock.getQueryData.mockImplementation((queryKey) => {
      if (JSON.stringify(queryKey) === JSON.stringify(['dashboards'])) {
        dashboardListReads += 1;
        return dashboardListReads > 1 ? [userCopy] : undefined;
      }
      if (JSON.stringify(queryKey) === JSON.stringify(['dashboards', 'slug', 'battery'])) {
        return systemDefault;
      }
      return undefined;
    });

    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: systemDefault, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(createMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_COPY_ID, ownerId: USER_ID }),
    );
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('stays in edit mode when both create and the refetch fallback fail', async () => {
    createMock.mockRejectedValue(new Error('network error'));
    qcMock.getQueryData.mockReturnValue(undefined); // nothing found after refetch

    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: systemDefault, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(exitEdit).not.toHaveBeenCalled();
  });

  it('exits edit mode without any API call when localConfig is null', async () => {
    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: null, exitEdit }),
      { updateMock, createMock, qcMock },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('admin editing a system default calls updateAdminDashboard, not create', async () => {
    const adminUpdateMock = vi.fn().mockResolvedValue(systemDefault);
    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: systemDefault, localConfig: { ...systemDefault, widgets: [] }, exitEdit }),
      { updateMock, createMock, adminUpdateMock, qcMock, isAdmin: true },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(adminUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: SYSTEM_DEFAULT_ID, isDefault: true }),
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('admin editing a user-owned copy uses the regular update path', async () => {
    const adminUpdateMock = vi.fn().mockResolvedValue(userCopy);
    const exitEdit = vi.fn();
    setup(
      makeShellState({ savedConfig: userCopy, localConfig: { ...userCopy, widgets: [] }, exitEdit }),
      { updateMock, createMock, adminUpdateMock, qcMock, isAdmin: true },
    );

    await userEvent.click(screen.getByTitle('Save changes'));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_COPY_ID, ownerId: USER_ID }),
    );
    expect(adminUpdateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(exitEdit).toHaveBeenCalledOnce();
  });

  it('treats super users as system-dashboard managers', () => {
    expect(canManageSystemDashboards('super_user')).toBe(true);
    expect(canManageSystemDashboards('admin')).toBe(true);
    expect(canManageSystemDashboards('user')).toBe(false);
  });
});
