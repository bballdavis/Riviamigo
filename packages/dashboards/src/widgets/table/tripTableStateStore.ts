import React from 'react';

type Listener = () => void;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 15;

const _state = {
  page: DEFAULT_PAGE,
  pageSize: DEFAULT_PAGE_SIZE,
  search: '',
  contextKey: '',
};

const _listeners = new Set<Listener>();

function _notify() {
  for (const listener of _listeners) listener();
}

export function resetTripTableState(contextKey: string, options?: { force?: boolean }) {
  if (!options?.force && _state.contextKey === contextKey) return;
  _state.contextKey = contextKey;
  _state.page = DEFAULT_PAGE;
  _state.pageSize = DEFAULT_PAGE_SIZE;
  _state.search = '';
  _notify();
}

export function setTripTablePage(page: number) {
  if (_state.page === page) return;
  _state.page = page;
  _notify();
}

export function setTripTablePageSize(pageSize: number) {
  if (_state.pageSize === pageSize) return;
  _state.pageSize = pageSize;
  _state.page = DEFAULT_PAGE;
  _notify();
}

export function setTripTableSearch(search: string) {
  if (_state.search === search) return;
  _state.search = search;
  _state.page = DEFAULT_PAGE;
  _notify();
}

export function useTripTableState() {
  const [, rerender] = React.useReducer((value: number) => value + 1, 0);

  React.useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);

  return {
    page: _state.page,
    pageSize: _state.pageSize,
    search: _state.search,
  };
}
