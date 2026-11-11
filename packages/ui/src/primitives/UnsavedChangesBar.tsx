import * as React from 'react';
import { Save, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';

export interface UnsavedChangesBarProps {
  /** Short summary, e.g. "Unsaved changes" or "2 unsaved changes". */
  message: React.ReactNode;
  /** Error from the last save attempt; the bar stays open until the user acts. */
  error?: string | null | undefined;
  saving?: boolean | undefined;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string | undefined;
  discardLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * Persistent page-level bar for staged edits: one Save and one Discard for the
 * whole page or subsection. Anchored to the bottom of the viewport with
 * safe-area padding; full width on phones and a centered floating bar on
 * larger screens. Render a spacer (see `UnsavedChangesBarSpacer`) at the end of
 * the page so the bar never covers the last fields.
 */
export function UnsavedChangesBar({
  message,
  error,
  saving = false,
  onSave,
  onDiscard,
  saveLabel = 'Save',
  discardLabel = 'Discard',
  className,
}: UnsavedChangesBarProps) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className={cn(
        // Centered in the content area: layouts with a side navigation publish
        // its width as --rm-content-inset-left so the bar never covers it.
        'fixed left-3 right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl',
        'lg:left-[calc(var(--rm-content-inset-left,0px)+0.75rem)]',
        'rounded-xl border border-accent/40 bg-bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-sm font-semibold text-fg">{message}</p>
          {error ? (
            <p role="alert" className="mt-0.5 break-words text-xs text-status-danger">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onDiscard}
            disabled={saving}
            iconLeft={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            {discardLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            loading={saving}
            iconLeft={<Save className="h-4 w-4" aria-hidden="true" />}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Keeps the last fields of a page reachable above the fixed bar. */
export function UnsavedChangesBarSpacer() {
  return <div aria-hidden="true" className="h-28 sm:h-24" />;
}
