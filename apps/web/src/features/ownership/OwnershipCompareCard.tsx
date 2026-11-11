/** The "Compare with" card: the tracked vehicle's chip, one toggle per comparison, and the add control. */
import { GitCompareArrows, Plus, X } from 'lucide-react';
import type { OwnershipResponse } from '@riviamigo/types';
import { Card, CardContent, CardHeader } from '@riviamigo/ui/primitives';
import { comparisonVehicles } from './model';
import { CHIP, SectionTitle } from './OwnershipPrimitives';

/** Most custom vehicles one Ownership page can hold. */
const MAX_CUSTOM_VEHICLES = 12;

export function OwnershipCompareCard({
  data,
  ownLabel,
  colors,
  enabledIds,
  insight,
  onToggle,
  onRemove,
  onAddVehicle,
}: {
  data: OwnershipResponse;
  ownLabel: string;
  colors: Record<string, string>;
  enabledIds: string[];
  insight: string | null;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAddVehicle: () => void;
}) {
  const allVehicles = comparisonVehicles(data);
  const customCount = data.settings.comparisons.custom.length;
  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<GitCompareArrows />}
          infoLabel="How the comparison works"
          info={
            <>
              <span className="block font-semibold text-fg">How the comparison works</span>
              <span className="mt-1 block text-fg-secondary">
                Every vehicle is driven your miles, month by month, from your purchase date, and pays the same gas
                and electricity prices. Turn a vehicle on or off to add or remove its line.
              </span>
              {insight ? <span className="mt-2 block border-t border-border pt-2 text-fg">{insight}</span> : null}
            </>
          }
        >
          Compare with
        </SectionTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <span
            className={`${CHIP} border-2 bg-accent/10 font-medium text-fg`}
            style={{ borderColor: colors.own }}
          >
            {ownLabel}
          </span>
          {allVehicles.map((vehicle) => {
            const on = enabledIds.includes(vehicle.id);
            const removable = vehicle.isCustom && data.can_edit;
            const edge = on ? { borderColor: colors[vehicle.id] } : undefined;
            return (
              <span key={vehicle.id} className="inline-flex items-stretch">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(vehicle.id)}
                  style={edge}
                  className={[
                    CHIP,
                    'border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    removable ? 'rounded-r-none' : '',
                    on
                      ? 'bg-bg-elevated font-medium text-fg'
                      : 'border-border text-fg-secondary hover:border-border-strong hover:text-fg-secondary',
                  ].join(' ')}
                >
                  {vehicle.label}
                </button>
                {removable ? (
                  <button
                    type="button"
                    aria-label={`Remove ${vehicle.label}`}
                    onClick={() => onRemove(vehicle.id)}
                    style={edge}
                    className={[
                      'inline-flex w-11 items-center justify-center rounded-r-lg border-2 border-l-0 transition-colors sm:w-9',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      on ? 'bg-bg-elevated text-fg-secondary hover:text-fg' : 'border-border text-fg-secondary hover:text-fg',
                    ].join(' ')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            );
          })}
          {data.can_edit && customCount < MAX_CUSTOM_VEHICLES ? (
            <button
              type="button"
              onClick={onAddVehicle}
              className={`${CHIP} gap-1.5 border-2 border-dashed border-border-strong text-fg-secondary hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            >
              <Plus className="h-4 w-4" />
              Add a vehicle
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
