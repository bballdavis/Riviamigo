import { Button, ResponsiveDialog } from '@riviamigo/ui/primitives';
import type { Vehicle } from '@riviamigo/types';
import { SettingsConfirmationDialog } from './SettingsConfirmationDialog';

export interface VehicleConfirmDialogsProps {
  vehicles: Vehicle[] | undefined;
  deleteConfirmId: string | null;
  deleteConfirmText: string;
  onDeleteConfirmTextChange: (text: string) => void;
  onDismissDelete: () => void;
  onConfirmDelete: (vehicleId: string) => void;
  deletePending: boolean;
  demoRefreshConfirmId: string | null;
  onDismissDemoRefresh: () => void;
  onConfirmDemoRefresh: (vehicleId: string) => Promise<unknown>;
}

/** The typed-DELETE vehicle removal and the demo refresh confirmation. Opened from the vehicle cards. */
export function VehicleConfirmDialogs({
  vehicles,
  deleteConfirmId,
  deleteConfirmText,
  onDeleteConfirmTextChange,
  onDismissDelete,
  onConfirmDelete,
  deletePending,
  demoRefreshConfirmId,
  onDismissDemoRefresh,
  onConfirmDemoRefresh,
}: VehicleConfirmDialogsProps) {
  return (
    <>
      {/* Delete confirmation dialog */}
      {deleteConfirmId && (() => {
        const dv = vehicles?.find((v) => v.id === deleteConfirmId);
        return (
          <ResponsiveDialog titleId="settings-delete-vehicle-title" onClose={onDismissDelete} className="sm:max-w-sm">
            <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:p-5">
              <h2 id="settings-delete-vehicle-title" className="text-base font-semibold text-fg">Delete {dv?.display_name}?</h2>
              <p className="text-sm text-fg-tertiary">
                This permanently removes all local telemetry, trips, and charging history for this vehicle.
                Type <strong className="font-semibold text-fg">DELETE</strong> below to confirm.
              </p>
              <input
                value={deleteConfirmText}
                onChange={(e) => onDeleteConfirmTextChange(e.target.value)}
                placeholder="DELETE"
                aria-label="Type DELETE to confirm"
                autoFocus
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-border bg-bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:p-5">
              <Button variant="secondary" size="sm" onClick={onDismissDelete}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={deleteConfirmText !== 'DELETE'}
                loading={deletePending}
                onClick={() => onConfirmDelete(deleteConfirmId)}
              >
                Delete Vehicle
              </Button>
            </footer>
          </ResponsiveDialog>
        );
      })()}

      {demoRefreshConfirmId && (() => {
        const demo = vehicles?.find((vehicle) => vehicle.id === demoRefreshConfirmId);
        return (
          <SettingsConfirmationDialog
            confirmation={{
              title: `Refresh ${demo?.display_name ?? 'demo vehicle'}?`,
              description: 'This replaces only the illustrative telemetry, trips, charging, and weather history with a fresh rolling 14-day demo window. Sharing and vehicle settings stay unchanged.',
              confirmLabel: 'Refresh Demo Data',
              run: () => onConfirmDemoRefresh(demoRefreshConfirmId),
            }}
            onClose={onDismissDemoRefresh}
          />
        );
      })()}
    </>
  );
}
