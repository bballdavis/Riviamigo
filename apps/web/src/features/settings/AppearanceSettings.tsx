import type { MapStylePreference } from '@riviamigo/types';
import { SelectPicker } from '@riviamigo/ui/primitives';

/** Map style picker. The value is staged by the parent Appearance draft; this control does not save. */
export function AppearanceSettings({ mapStyle, onChange, disabled }: {
  mapStyle: MapStylePreference;
  onChange: (value: MapStylePreference) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Map style</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose the basemap used across trip maps.</p>
          </div>
          <SelectPicker
            value={mapStyle}
            onChange={(value) => onChange(value as MapStylePreference)}
            disabled={disabled}
            aria-label="Map style"
            size="sm"
            className="w-full sm:w-52"
            options={[
              { value: 'follow-theme', label: 'Follow appearance' },
              { value: 'positron', label: 'Positron' },
              { value: 'bright', label: 'Bright' },
              { value: 'liberty', label: 'Liberty' },
              { value: 'dark', label: 'Dark' },
              { value: 'fiord', label: 'Fiord' },
              { value: '3d', label: '3D (Liberty)' },
            ]}
          />
    </div>
  );
}
