import { useUpdateMapStyle } from '@riviamigo/hooks';
import type { MapStylePreference } from '@riviamigo/types';
import { SelectPicker } from '@riviamigo/ui/primitives';

export function AppearanceSettings({ mapStyle }: { mapStyle: MapStylePreference }) {
  const updateMapStyle = useUpdateMapStyle();

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Map style</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose the basemap used across trip maps.</p>
          </div>
          <SelectPicker
            value={mapStyle}
            onChange={(value) => updateMapStyle.mutate(value as MapStylePreference)}
            disabled={updateMapStyle.isPending}
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
          {updateMapStyle.isError ? <p role="alert" className="text-xs text-status-danger sm:col-span-2">Unable to save map style.</p> : null}
    </div>
  );
}
