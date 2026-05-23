import React from 'react';
import { Calendar, Clock, Zap, Edit2, Save, X } from 'lucide-react';
import {
  useChargingSchedule,
  useUpdateChargingSchedule,
} from '@riviamigo/hooks';
import type { ChargingScheduleInput } from '@riviamigo/hooks';
import { Button } from '@riviamigo/ui/primitives';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function minutesToTimeStr(mins: number | null): string {
  if (mins === null) return '';
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeStrToMinutes(t: string): number | null {
  const parts = t.split(':').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function formatDays(days: string[] | null): string {
  if (!days || days.length === 0) return 'No days set';
  if (days.length === 7) return 'Every day';
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekend = ['Saturday', 'Sunday'];
  if (weekdays.every((d) => days.includes(d)) && days.length === 5) return 'Weekdays';
  if (weekend.every((d) => days.includes(d)) && days.length === 2) return 'Weekends';
  return days.map((d) => d.slice(0, 3)).join(', ');
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  enabled: boolean;
  startTime: string;   // "HH:MM"
  durationHours: string;
  amperage: string;
  weekDays: string[];
}

function scheduleToForm(s: { enabled: boolean; start_time_minutes: number | null; duration_minutes: number | null; amperage: number | null; week_days: string[] | null }): FormState {
  return {
    enabled: s.enabled,
    startTime: minutesToTimeStr(s.start_time_minutes),
    durationHours: s.duration_minutes !== null ? String(Math.round(s.duration_minutes / 60 * 10) / 10) : '',
    amperage: s.amperage !== null ? String(s.amperage) : '',
    weekDays: s.week_days ?? [],
  };
}

function formToInput(f: FormState): ChargingScheduleInput {
  const startMins = timeStrToMinutes(f.startTime);
  const durationMins = f.durationHours !== '' ? Math.round(parseFloat(f.durationHours) * 60) : null;
  const amp = f.amperage !== '' ? parseFloat(f.amperage) : null;
  return {
    enabled: f.enabled,
    start_time_minutes: startMins,
    duration_minutes: isNaN(durationMins ?? NaN) ? null : durationMins,
    amperage: amp !== null && isNaN(amp) ? null : amp,
    week_days: f.weekDays.length > 0 ? f.weekDays : null,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChargingScheduleEditorWidget({
  instance: _instance,
  ctx,
}: {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}) {
  const vehicleId = ctx.vehicleId ?? null;
  const { data: schedule, isLoading } = useChargingSchedule(vehicleId);
  const update = useUpdateChargingSchedule(vehicleId);

  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<FormState>({
    enabled: false,
    startTime: '',
    durationHours: '',
    amperage: '',
    weekDays: [],
  });

  React.useEffect(() => {
    if (schedule) {
      setForm(scheduleToForm(schedule));
    }
  }, [schedule]);

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      weekDays: prev.weekDays.includes(day)
        ? prev.weekDays.filter((d) => d !== day)
        : [...prev.weekDays, day],
    }));
  }

  async function handleSave() {
    await update.mutateAsync(formToInput(form));
    setEditing(false);
  }

  function handleCancel() {
    if (schedule) setForm(scheduleToForm(schedule));
    setEditing(false);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-fg-tertiary">Loading schedule…</span>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Calendar className="h-8 w-8 text-fg-tertiary" />
        <p className="text-sm text-fg-tertiary">No charging schedule configured.</p>
        <Button size="sm" variant="secondary" onClick={() => {
          setForm({ enabled: false, startTime: '22:00', durationHours: '4', amperage: '32', weekDays: DAYS });
          setEditing(true);
        }}>
          Set Up Schedule
        </Button>
        {editing && <ScheduleForm form={form} setForm={setForm} toggleDay={toggleDay} onSave={handleSave} onCancel={handleCancel} saving={update.isPending} />}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-fg-tertiary" />
          <span className="text-sm font-medium text-fg">Charging Schedule</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            schedule.enabled
              ? 'bg-[color:var(--rm-status-positive)]/15 text-[color:var(--rm-status-positive)]'
              : 'bg-bg-elevated text-fg-tertiary'
          }`}>
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" iconLeft={<Edit2 className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <ScheduleForm
          form={form}
          setForm={setForm}
          toggleDay={toggleDay}
          onSave={handleSave}
          onCancel={handleCancel}
          saving={update.isPending}
        />
      ) : (
        <ScheduleReadView schedule={schedule} form={form} />
      )}
    </div>
  );
}

function ScheduleReadView({
  schedule,
  form,
}: {
  schedule: { start_time_minutes: number | null; duration_minutes: number | null; amperage: number | null; week_days: string[] | null };
  form: FormState;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Start Time" value={form.startTime || '—'} />
      <InfoRow
        icon={<Clock className="h-3.5 w-3.5" />}
        label="Duration"
        value={schedule.duration_minutes !== null ? `${Math.round(schedule.duration_minutes / 60 * 10) / 10}h` : '—'}
      />
      <InfoRow icon={<Zap className="h-3.5 w-3.5" />} label="Amperage" value={schedule.amperage !== null ? `${schedule.amperage}A` : '—'} />
      <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label="Days" value={formatDays(schedule.week_days)} />
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-bg-elevated px-3 py-2">
      <span className="mt-0.5 shrink-0 text-fg-tertiary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-fg-tertiary">{label}</p>
        <p className="truncate text-sm font-medium text-fg">{value}</p>
      </div>
    </div>
  );
}

function ScheduleForm({
  form,
  setForm,
  toggleDay,
  onSave,
  onCancel,
  saving,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  toggleDay: (day: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Enabled toggle */}
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          className="h-4 w-4 accent-[color:var(--rm-accent)]"
        />
        <span className="text-sm text-fg">Enable schedule</span>
      </label>

      {/* Start time + duration */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-tertiary">Start Time</label>
          <input
            type="time"
            value={form.startTime}
            onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
            className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-tertiary">Duration (hrs)</label>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="24"
            value={form.durationHours}
            onChange={(e) => setForm((p) => ({ ...p, durationHours: e.target.value }))}
            placeholder="e.g. 4"
            className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Amperage */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-fg-tertiary">Amperage (A)</label>
        <input
          type="number"
          step="1"
          min="1"
          max="48"
          value={form.amperage}
          onChange={(e) => setForm((p) => ({ ...p, amperage: e.target.value }))}
          placeholder="e.g. 32"
          className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Days of week */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-fg-tertiary">Days</label>
        <div className="flex gap-1">
          {DAYS.map((day, i) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                form.weekDays.includes(day)
                  ? 'bg-accent text-fg-on-accent'
                  : 'bg-bg-elevated text-fg-tertiary hover:bg-bg-elevated/80'
              }`}
            >
              {DAY_SHORT[i]}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          iconLeft={<Save className="h-3.5 w-3.5" />}
          loading={saving}
          onClick={onSave}
          className="flex-1"
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<X className="h-3.5 w-3.5" />}
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Registry ──────────────────────────────────────────────────────────────────

registerWidget({
  componentType: 'custom',
  definitionId: 'charging.schedule.editor',
  title: 'Charging Schedule',
  defaultSize: { w: 5, h: 8 },
  minSize: { w: 4, h: 6 },
  defaultOptions: {},
  component: ChargingScheduleEditorWidget,
});
