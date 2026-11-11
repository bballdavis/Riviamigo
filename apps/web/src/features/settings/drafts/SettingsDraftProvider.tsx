import * as React from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Save, Trash2 } from 'lucide-react';
import {
  Button,
  ResponsiveDialog,
  UnsavedChangesBar,
  UnsavedChangesBarSpacer,
} from '@riviamigo/ui/primitives';

/**
 * Settings edits are staged, not saved on change. Each editable group
 * registers a draft with `useSettingsDraft`; while any draft is dirty the
 * provider shows one page-level Save / Discard bar. Save runs every dirty
 * draft's `save` in registration order; Discard resets them all.
 *
 * Leaving with unsaved changes (another settings section, another vehicle in a
 * section, another route, or closing the tab) asks Save / Discard / Stay.
 */

export interface SettingsDraftInput {
  isDirty: boolean;
  /** Persist the draft. Reject (throw) with a user-facing message to keep the bar open. */
  save: () => Promise<unknown>;
  /** Reset the draft to the last saved values. */
  discard: () => void;
}

interface RegisteredDraft {
  save: () => Promise<unknown>;
  discard: () => void;
}

interface SettingsDraftContextValue {
  setDraft: (id: string, draft: RegisteredDraft | null) => void;
  hasUnsavedChanges: boolean;
  saving: boolean;
  requestLeave: (action: () => void) => void;
}

const SettingsDraftContext = React.createContext<SettingsDraftContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Some changes could not be saved. Check the highlighted fields and try again.';
}

export function SettingsDraftProvider({ children }: { children: React.ReactNode }) {
  const [drafts, setDrafts] = React.useState<ReadonlyMap<string, RegisteredDraft>>(() => new Map());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = React.useState<(() => void) | null>(null);
  const draftsRef = React.useRef(drafts);
  draftsRef.current = drafts;
  const hasUnsavedChanges = drafts.size > 0;

  const setDraft = React.useCallback((id: string, draft: RegisteredDraft | null) => {
    setDrafts((current) => {
      if (draft === null && !current.has(id)) return current;
      const next = new Map(current);
      if (draft === null) next.delete(id);
      else next.set(id, draft);
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!hasUnsavedChanges) setError(null);
  }, [hasUnsavedChanges]);

  const saveAll = React.useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      for (const draft of [...draftsRef.current.values()]) {
        await draft.save();
      }
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const discardAll = React.useCallback(() => {
    for (const draft of [...draftsRef.current.values()]) draft.discard();
    setError(null);
  }, []);

  const requestLeave = React.useCallback((action: () => void) => {
    if (draftsRef.current.size === 0) action();
    else setPendingLeave(() => action);
  }, []);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => draftsRef.current.size > 0 && current.pathname !== next.pathname,
    enableBeforeUnload: () => draftsRef.current.size > 0,
    withResolver: true,
  });

  React.useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasUnsavedChanges, saveAll]);

  const leaveOpen = pendingLeave !== null || blocker.status === 'blocked';
  const finishLeave = React.useCallback((proceed: boolean) => {
    const action = pendingLeave;
    setPendingLeave(null);
    if (blocker.status === 'blocked') {
      if (proceed) blocker.proceed?.();
      else blocker.reset?.();
    } else if (proceed) {
      action?.();
    }
  }, [blocker, pendingLeave]);

  const value = React.useMemo<SettingsDraftContextValue>(
    () => ({ setDraft, hasUnsavedChanges, saving, requestLeave }),
    [hasUnsavedChanges, requestLeave, saving, setDraft],
  );

  return (
    <SettingsDraftContext.Provider value={value}>
      {children}
      {hasUnsavedChanges ? (
        <>
          <UnsavedChangesBarSpacer />
          <UnsavedChangesBar
            message="Unsaved changes"
            error={error}
            saving={saving}
            onSave={() => { void saveAll(); }}
            onDiscard={discardAll}
          />
        </>
      ) : null}
      {leaveOpen ? (
        <ResponsiveDialog titleId="settings-unsaved-title" onClose={() => finishLeave(false)} className="sm:max-w-md">
          <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:p-5">
            <h2 id="settings-unsaved-title" className="text-base font-semibold text-fg">Save your changes?</h2>
            <p className="text-sm text-fg-secondary">You have unsaved changes on this page. Save them before leaving, or discard them.</p>
          </div>
          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:p-5">
            <Button type="button" variant="secondary" onClick={() => finishLeave(false)} disabled={saving}>Stay</Button>
            <Button
              type="button"
              variant="danger"
              disabled={saving}
              iconLeft={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => { discardAll(); finishLeave(true); }}
            >
              Discard
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saving}
              iconLeft={<Save className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                void saveAll().then((saved) => finishLeave(saved));
              }}
            >
              Save
            </Button>
          </footer>
        </ResponsiveDialog>
      ) : null}
    </SettingsDraftContext.Provider>
  );
}

/**
 * Registers an editable group's staged draft with the Settings page. The bar
 * appears while `isDirty` is true. Outside a provider (for example in an
 * isolated component test) the hook is inert and returns `standalone: true`, so
 * callers can render their own fallback controls.
 */
export function useSettingsDraft(id: string, { isDirty, save, discard }: SettingsDraftInput) {
  const context = React.useContext(SettingsDraftContext);
  const latest = React.useRef({ save, discard });
  latest.current = { save, discard };
  const setDraft = context?.setDraft;

  React.useEffect(() => {
    if (!setDraft) return;
    setDraft(id, isDirty ? { save: () => latest.current.save(), discard: () => latest.current.discard() } : null);
  }, [id, isDirty, setDraft]);

  React.useEffect(() => () => setDraft?.(id, null), [id, setDraft]);

  return { saving: context?.saving ?? false, standalone: context === null };
}

/** Run `action` now, or after the user saves or discards pending changes. */
export function useSettingsLeaveGuard() {
  const context = React.useContext(SettingsDraftContext);
  return React.useCallback(
    (action: () => void) => {
      if (context) context.requestLeave(action);
      else action();
    },
    [context],
  );
}

export function useSettingsHasUnsavedChanges() {
  return React.useContext(SettingsDraftContext)?.hasUnsavedChanges ?? false;
}
