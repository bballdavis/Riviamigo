import type { UnitPreferences } from '@riviamigo/types';
import type { UnitMode } from '@riviamigo/ui/lib/utils';
import { appTimezoneOptions } from '@riviamigo/ui/lib/dateTime';
import { Badge, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';

export interface UnitsSectionProps {
  unitPreferences: UnitPreferences;
  onUnitModeChange: (mode: UnitMode) => void;
  onCustomUnitChange: <K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) => void;
  appTimezone: string;
  onAppTimezoneChange: (timezone: string) => void;
  appTimezoneDisabled: boolean;
  canManageBackups: boolean;
}

/** Unit presets, custom units, and the application time zone. Staged edits live in SettingsContent. */
export function UnitsSection({
  unitPreferences,
  onUnitModeChange,
  onCustomUnitChange,
  appTimezone,
  onAppTimezoneChange,
  appTimezoneDisabled,
  canManageBackups,
}: UnitsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Units</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-fg-tertiary">Pick a preset system or switch to Custom for per-unit control.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              value: 'imperial' as const,
              title: 'Imperial',
              copy: 'Miles, mph, Fahrenheit, psi, and feet. This is the default.',
            },
            {
              value: 'metric' as const,
              title: 'Metric',
              copy: 'Kilometers, km/h, Celsius, kPa, and meters.',
            },
            {
              value: 'custom' as const,
              title: 'Custom',
              copy: 'Choose each unit family independently.',
            },
          ].map((option) => {
            const active = unitPreferences.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onUnitModeChange(option.value)}
                className={[
                  'rounded-xl border p-4 text-left transition-colors',
                  active
                    ? 'border-accent bg-accent/10 shadow-sm'
                    : 'border-border bg-bg-elevated/40 hover:border-accent/60 hover:bg-bg-elevated/70',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-fg">{option.title}</p>
                    <p className="mt-1 text-xs text-fg-tertiary">{option.copy}</p>
                  </div>
                  <Badge variant={active ? 'success' : 'default'}>
                    {active ? 'Selected' : 'Set'}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
        {unitPreferences.mode === 'custom' ? (
          <div className="rounded-xl border border-border bg-bg-elevated/35 p-3">
            <p className="mb-3 text-xs uppercase tracking-wider text-fg-tertiary">Custom Units</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-fg">
                <span>Distance / Range</span>
                <SelectPicker className="w-full" value={unitPreferences.distance_unit} onChange={(value) => onCustomUnitChange('distance_unit', value as UnitPreferences['distance_unit'])} aria-label="Distance and range unit" options={[{ value: 'miles', label: 'Miles (mi)' }, { value: 'kilometers', label: 'Kilometers (km)' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg">
                <span>Speed</span>
                <SelectPicker className="w-full" value={unitPreferences.speed_unit} onChange={(value) => onCustomUnitChange('speed_unit', value as UnitPreferences['speed_unit'])} aria-label="Speed unit" options={[{ value: 'mph', label: 'Miles/hour (mph)' }, { value: 'kmh', label: 'Kilometers/hour (km/h)' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg">
                <span>Temperature</span>
                <SelectPicker className="w-full" value={unitPreferences.temperature_unit} onChange={(value) => onCustomUnitChange('temperature_unit', value as UnitPreferences['temperature_unit'])} aria-label="Temperature unit" options={[{ value: 'fahrenheit', label: 'Fahrenheit (F)' }, { value: 'celsius', label: 'Celsius (C)' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg">
                <span>Pressure</span>
                <SelectPicker className="w-full" value={unitPreferences.pressure_unit} onChange={(value) => onCustomUnitChange('pressure_unit', value as UnitPreferences['pressure_unit'])} aria-label="Pressure unit" options={[{ value: 'psi', label: 'PSI' }, { value: 'kpa', label: 'kPa' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg">
                <span>Altitude</span>
                <SelectPicker className="w-full" value={unitPreferences.altitude_unit} onChange={(value) => onCustomUnitChange('altitude_unit', value as UnitPreferences['altitude_unit'])} aria-label="Altitude unit" options={[{ value: 'feet', label: 'Feet (ft)' }, { value: 'meters', label: 'Meters (m)' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg">
                <span>Place Radius</span>
                <SelectPicker className="w-full" value={unitPreferences.place_radius_unit} onChange={(value) => onCustomUnitChange('place_radius_unit', value as UnitPreferences['place_radius_unit'])} aria-label="Place radius unit" options={[{ value: 'feet', label: 'Feet (ft)' }, { value: 'meters', label: 'Meters (m)' }]} />
              </label>
              <label className="grid gap-1 text-sm text-fg md:col-span-2">
                <span>Efficiency Display</span>
                <SelectPicker className="w-full" value={unitPreferences.efficiency_display} onChange={(value) => onCustomUnitChange('efficiency_display', value as UnitPreferences['efficiency_display'])} aria-label="Efficiency display" options={[{ value: 'distance_per_energy', label: 'Distance per energy (mi/kWh or km/kWh)' }, { value: 'energy_per_distance', label: 'Energy per distance (Wh/mi or Wh/km)' }]} />
              </label>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
          <div>
            <p className="text-xs uppercase tracking-wider text-fg-tertiary">Time zone</p>
            <p className="mt-1 text-sm text-fg">Application time zone</p>
            <p className="mt-1 text-xs text-fg-tertiary">
              All Riviamigo dates, charts, local-day groupings, and scheduled backups use this time zone.
              {!canManageBackups ? ' An administrator manages this shared setting.' : ''}
            </p>
          </div>
          <SelectPicker
            className="w-full"
            value={appTimezone}
            onChange={onAppTimezoneChange}
            aria-label="Application time zone"
            disabled={appTimezoneDisabled}
            options={appTimezoneOptions(appTimezone)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
