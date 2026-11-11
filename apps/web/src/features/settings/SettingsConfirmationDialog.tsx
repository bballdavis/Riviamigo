import React from 'react';
import { Button, ResponsiveDialog } from '@riviamigo/ui/primitives';

/** A confirmed Settings action. `run` settles when the action finishes; the dialog closes then. */
export interface SettingsConfirmation {
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  run: () => Promise<unknown>;
}

/**
 * In-app replacement for `window.confirm` on Settings surfaces. Cancel and Escape dismiss
 * without running the action; the confirm button shows loading while the action is in flight.
 */
export function SettingsConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: SettingsConfirmation;
  onClose: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const titleId = 'settings-confirm-title';
  const dismiss = () => {
    if (!pending) onClose();
  };
  async function confirm() {
    setPending(true);
    try {
      await confirmation.run();
    } catch {
      // The mutation records its own failure; the dialog only has to close.
    } finally {
      setPending(false);
      onClose();
    }
  }

  return (
    <ResponsiveDialog titleId={titleId} onClose={dismiss}>
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <h2 id={titleId} className="text-base font-semibold text-fg">{confirmation.title}</h2>
        {confirmation.description ? (
          <p className="mt-2 text-sm text-fg-tertiary">{confirmation.description}</p>
        ) : null}
        <div className="mt-auto flex flex-col-reverse gap-2 pt-6 sm:mt-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="md" disabled={pending} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="md"
            loading={pending}
            onClick={() => { void confirm(); }}
          >
            {confirmation.confirmLabel}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
