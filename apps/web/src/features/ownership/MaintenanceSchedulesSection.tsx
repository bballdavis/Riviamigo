import React, { useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import type { OwnershipResponse } from '@riviamigo/types';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { buildLedger, scheduleTargets } from './model';
import { normalizeScheduleEdits, toDraft, type ScheduleEdits, type ScheduleErrors } from './maintenanceScheduleDrafts';
import { ScheduleEditor } from './maintenanceScheduleEditor';

export {
  applyScheduleEdits,
  draftsToSchedule,
  normalizeScheduleEdits,
  type ItemDraft,
  type ItemErrors,
  type ScheduleEdit,
  type ScheduleEdits,
  type ScheduleErrors,
} from './maintenanceScheduleDrafts';
export { dueSoFarText, timesPerYear } from './maintenanceScheduleMath';

/** The maintenance schedule behind every vehicle on one Rivian's Ownership page. */
export function MaintenanceSchedulesCard(props: VehicleSchedulesProps) {
  return (
    <Card>
      <CardHeader className="mb-3 flex-col items-start gap-1">
        <SettingsCardTitle icon={<Wrench />} color={CHART_COLORS.violet}>
          Maintenance schedules
        </SettingsCardTitle>
        <p className="text-sm text-fg-secondary">
          What each vehicle on the Ownership page needs and how often. Each item is due at its mileage or its time
          interval, whichever comes first, counting from the purchase date. The built-in schedules follow the
          manufacturers&apos; published intervals and typical U.S. prices. Only items that have fallen due count
          toward To Date; the rest show up in Project.
        </p>
      </CardHeader>
      <CardContent>
        <VehicleSchedules {...props} />
      </CardContent>
    </Card>
  );
}

/** Card heading used across Settings > Ownership: accent icon and a bold title. */
export function SettingsCardTitle({
  icon,
  color = CHART_COLORS.sky,
  children,
}: {
  icon: React.ReactElement<{ className?: string }>;
  /** Icon color; each section on a page gets its own. The title stays primary text. */
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <CardTitle className="flex items-center gap-2 text-base font-bold normal-case tracking-normal text-fg">
      <span aria-hidden style={{ color }}>
        {React.cloneElement(icon, { className: 'h-5 w-5' })}
      </span>
      {children}
    </CardTitle>
  );
}

interface VehicleSchedulesProps {
  /** The vehicle's ownership data, as last saved. */
  data: OwnershipResponse;
  ownLabel: string;
  edits: ScheduleEdits;
  errors: ScheduleErrors;
  onEditsChange: (edits: ScheduleEdits) => void;
}

function VehicleSchedules({ data, ownLabel, edits, errors, onEditsChange }: VehicleSchedulesProps) {
  const [targetKey, setTargetKey] = useState('own');
  const [now] = useState(() => new Date());

  const targets = useMemo(() => scheduleTargets(data, ownLabel), [data, ownLabel]);
  const ledger = useMemo(() => buildLedger(data, { horizon: 'to_date', now, ownLabel }), [data, now, ownLabel]);
  const milesPerMonth = ledger?.avgMonthlyMiles ?? 0;

  const target = targets.find((entry) => entry.key === targetKey) ?? targets[0];
  if (!target) return null;
  const edit = edits[target.key];

  return (
    <div className="grid gap-4">
      <SelectPicker
        className="w-full sm:max-w-sm"
        aria-label="Vehicle schedule to edit"
        value={target.key}
        onChange={(key) => setTargetKey(key)}
        options={targets.map((entry) => ({
          value: entry.key,
          label: edits[entry.key] ? `${entry.label} (unsaved)` : entry.edited ? `${entry.label} (edited)` : entry.label,
          group: entry.key === 'own' ? 'Your vehicle' : 'Compared vehicles',
        }))}
      />
      <ScheduleEditor
        key={target.key}
        title={target.label}
        drafts={edit?.drafts ?? target.schedule.map(toDraft)}
        errors={errors[target.key] ?? []}
        builtIn={target.builtIn}
        edited={edit ? !edit.resetToBuiltIn : target.edited}
        canReset={edit ? !edit.resetToBuiltIn : target.edited}
        canEdit={data.can_edit}
        milesPerMonth={milesPerMonth}
        startMs={ledger?.startMs ?? now.getTime()}
        nowMs={now.getTime()}
        onChange={(next) =>
          onEditsChange(normalizeScheduleEdits({ ...edits, [target.key]: next }, targets))
        }
        resetToBuiltIn={edit?.resetToBuiltIn ?? false}
      />
    </div>
  );
}
