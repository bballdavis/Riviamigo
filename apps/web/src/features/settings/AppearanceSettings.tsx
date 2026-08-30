import { useBasemapConfig, useUpdateMapStyle, useUserPreferences } from '@riviamigo/hooks';
import { SelectPicker, ThemeToggle } from '@riviamigo/ui/primitives';

export function AppearanceSettings() {
  const basemapConfig = useBasemapConfig();
  const userPreferences = useUserPreferences();
  const updateMapStyle = useUpdateMapStyle();
  const openFreeMap = basemapConfig.data?.resolved_provider === 'openfreemap';

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">Theme</p>
          <p className="mt-0.5 text-xs text-fg-tertiary">Toggle between dark, light, and system appearance</p>
        </div>
        <ThemeToggle />
      </div>
      {openFreeMap ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Map style</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose the basemap used across trip maps.</p>
          </div>
          <SelectPicker
            value={userPreferences.data?.map_style ?? 'follow-theme'}
            onChange={(value) => updateMapStyle.mutate(value)}
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
      ) : null}
    </div>
  );
}
