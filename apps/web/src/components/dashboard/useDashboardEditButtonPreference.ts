import React from 'react';

const STORAGE_PREFIX = 'rm-show-dashboard-edit-button';
const CHANGE_EVENT = 'rm-dashboard-edit-button-preference-change';

function storageKey(userId: string | null | undefined) {
  return `${STORAGE_PREFIX}:${userId ?? 'anonymous'}`;
}

function readPreference(userId: string | null | undefined) {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(storageKey(userId)) === 'true';
}

export function useDashboardEditButtonPreference(userId: string | null | undefined) {
  const [showEditButton, setShowEditButton] = React.useState(false);

  React.useEffect(() => {
    setShowEditButton(readPreference(userId));
  }, [userId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleChange = () => setShowEditButton(readPreference(userId));
    window.addEventListener('storage', handleChange);
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener('storage', handleChange);
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, [userId]);

  const updateShowEditButton = React.useCallback((next: boolean) => {
    setShowEditButton(next);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey(userId), String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [userId]);

  return [showEditButton, updateShowEditButton] as const;
}
