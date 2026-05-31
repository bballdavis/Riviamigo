import React from 'react';
import type { TripRow } from '@riviamigo/ui/tables';

type Listener = () => void;

const _state = {
  selectedIds: [] as string[],
  tripRegistry: {} as Record<string, TripRow>,
  contextKey: '',
};

const _listeners = new Set<Listener>();

function _notify() {
  for (const fn of _listeners) fn();
}

/** Resets selection when the vehicle/date context changes, or forcibly when requested. */
export function resetTripSelection(contextKey: string, options?: { force?: boolean }) {
  if (!options?.force && _state.contextKey === contextKey) return;
  _state.contextKey = contextKey;
  _state.selectedIds = [];
  _state.tripRegistry = {};
  _notify();
}

export function toggleTripSelection(id: string) {
  _state.selectedIds = _state.selectedIds.includes(id)
    ? _state.selectedIds.filter((x) => x !== id)
    : [..._state.selectedIds, id];
  _notify();
}

export function clearTripSelection() {
  if (_state.selectedIds.length === 0) return;
  _state.selectedIds = [];
  _notify();
}

/** Adds trips to the registry so stats can be computed from selected trip data. */
export function registerTripsInStore(trips: TripRow[]) {
  for (const trip of trips) {
    _state.tripRegistry[trip.id] = trip;
  }
}

export function useTripSelection() {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    selectedIds: _state.selectedIds,
    tripRegistry: _state.tripRegistry,
  };
}
