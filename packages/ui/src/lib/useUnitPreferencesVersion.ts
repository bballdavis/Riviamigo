import { useSyncExternalStore } from 'react';
import { getUnitPreferences } from './utils';

function subscribeToUnits(onChange: () => void) {
  window.addEventListener('rm-units-change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('rm-units-change', onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Re-renders the caller whenever any unit preference changes (including the
 * efficiency display, not just the unit mode). Formatters read preferences at
 * render time, so a surface that formats numbers must subscribe to this.
 */
export function useUnitPreferencesVersion() {
  return useSyncExternalStore(
    subscribeToUnits,
    () => JSON.stringify(getUnitPreferences()),
    () => '',
  );
}
