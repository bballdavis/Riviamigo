import type { ThemePalette } from '@riviamigo/types';
import { useThemeRuntime } from '../lib/themeRuntime';

/** Returns the active account-backed palette resolved on the document root. */
export function useDocumentPalette(): ThemePalette {
  return useThemeRuntime().legacyPalette;
}
