import React from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useOwnershipEnabled, useUpdateOwnershipPreference } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Card, CardContent, Switch } from '@riviamigo/ui/primitives';
import { MaintenanceSchedulesSection } from './MaintenanceSchedulesSection';

/**
 * Settings > Ownership. The switch at the top shows or hides the Ownership
 * dashboard for the signed-in user; everything below it configures that
 * dashboard and only appears while it is on.
 */
export function OwnershipSettingsSection({ vehicles }: { vehicles: Vehicle[] }) {
  const enabled = useOwnershipEnabled();
  const update = useUpdateOwnershipPreference();

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="mt-0.5 text-accent">
                <CircleDollarSign className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <label htmlFor="ownership-enabled" className="block text-base font-bold text-fg">
                  Show Ownership
                </label>
                <p className="mt-1 text-sm text-fg-secondary">
                  The Ownership page adds up what your Rivian has cost and compares it with other vehicles. Turn it off
                  to hide it from your navigation. Your saved prices and schedules are kept, and this only affects
                  your own account.
                </p>
                {update.isError ? (
                  <p role="alert" className="mt-2 text-sm text-status-danger">
                    The setting could not be saved. Try again.
                  </p>
                ) : null}
              </div>
            </div>
            <Switch
              id="ownership-enabled"
              checked={enabled}
              disabled={update.isPending}
              onChange={(checked) => update.mutate(checked)}
              aria-label="Show Ownership"
            />
          </div>
        </CardContent>
      </Card>
      {enabled ? <MaintenanceSchedulesSection vehicles={vehicles} /> : null}
    </div>
  );
}
