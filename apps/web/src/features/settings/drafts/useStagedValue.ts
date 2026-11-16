import * as React from 'react';
import { useSettingsSaving } from './SettingsDraftProvider';

function defaultEquals<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export interface StagedValue<T> {
  /** The value the controls edit. */
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  /** True while `value` differs from the last saved value. */
  isDirty: boolean;
  /** Drop staged edits and return to the saved value. */
  reset: () => void;
  /**
   * Adopt `next` as the saved baseline (call after a successful save so the
   * page is clean before any refetch lands). Pass the value that was submitted
   * as `submitted` to keep edits the user made while the save was running.
   */
  commit: (next: T, submitted?: T) => void;
}

/**
 * Local draft of a saved value. While the draft is clean it follows `saved`
 * (so refetches and other tabs show up); once the user edits it, refetches no
 * longer overwrite the edits until they are saved or discarded. While the
 * Settings page is saving, `saved` is not followed at all: optimistic cache
 * writes and rollbacks must not make a draft look clean (and drop it) before
 * its own save has finished.
 */
export function useStagedValue<T>(saved: T, equals: (left: T, right: T) => boolean = defaultEquals): StagedValue<T> {
  const [baseline, setBaseline] = React.useState<T>(saved);
  const [value, setValue] = React.useState<T>(saved);
  const isDirty = !equals(value, baseline);
  const dirtyRef = React.useRef(isDirty);
  dirtyRef.current = isDirty;
  const equalsRef = React.useRef(equals);
  equalsRef.current = equals;

  const saving = useSettingsSaving();
  // The last server value this draft followed. Only a real change from it is
  // adopted, so the end of a save (or an optimistic write that was rolled
  // back) never pulls the baseline back to a value that is already stale.
  const followedRef = React.useRef(saved);

  React.useEffect(() => {
    if (saving || equalsRef.current(followedRef.current, saved)) return;
    followedRef.current = saved;
    setBaseline((current) => (equalsRef.current(current, saved) ? current : saved));
    if (!dirtyRef.current) setValue((current) => (equalsRef.current(current, saved) ? current : saved));
  }, [saved, saving]);

  const reset = React.useCallback(() => setValue(baseline), [baseline]);
  const commit = React.useCallback((next: T, submitted?: T) => {
    setBaseline(next);
    setValue((current) =>
      submitted === undefined || equalsRef.current(current, submitted) ? next : current,
    );
  }, []);

  return { value, setValue, isDirty, reset, commit };
}
