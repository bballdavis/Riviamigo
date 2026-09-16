import { useThemeRuntime } from '../lib/themeRuntime';

/** Returns `true` when the document root has the `dark` class (or lacks `light`). */
export function useDocumentTheme(): boolean {
  return useThemeRuntime().effectiveMode === 'dark';
}
