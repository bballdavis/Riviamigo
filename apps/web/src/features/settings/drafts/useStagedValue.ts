import * as React from 'react';

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
   * page is clean before any refetch lands).
   */
  commit: (next: T) => void;
}

/**
 * Local draft of a saved value. While the draft is clean it follows `saved`
 * (so refetches and other tabs show up); once the user edits it, refetches no
 * longer overwrite the edits until they are saved or discarded.
 */
export function useStagedValue<T>(saved: T, equals: (left: T, right: T) => boolean = defaultEquals): StagedValue<T> {
  const [baseline, setBaseline] = React.useState<T>(saved);
  const [value, setValue] = React.useState<T>(saved);
  const isDirty = !equals(value, baseline);
  const dirtyRef = React.useRef(isDirty);
  dirtyRef.current = isDirty;
  const equalsRef = React.useRef(equals);
  equalsRef.current = equals;

  React.useEffect(() => {
    setBaseline((current) => (equalsRef.current(current, saved) ? current : saved));
    if (!dirtyRef.current) setValue((current) => (equalsRef.current(current, saved) ? current : saved));
  }, [saved]);

  const reset = React.useCallback(() => setValue(baseline), [baseline]);
  const commit = React.useCallback((next: T) => {
    setBaseline(next);
    setValue(next);
  }, []);

  return { value, setValue, isDirty, reset, commit };
}
