import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { Place, PlaceAddress, PlaceChargingInput, PlaceSearchSuggestion, TouPeriod, UpsertPlaceBody } from '@riviamigo/types';
import type { UnitSystem } from '@riviamigo/ui/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { HelpCircle, Home, Loader2, Pencil, Plus, Search, Zap, Trash2 } from 'lucide-react';

type PlanType = 'per_kwh' | 'tou';
type PlaceType = 'home' | 'work' | 'poi';

interface ScheduleDraft {
  label: string;
  start: string;
  end: string;
  rate: string;
}

interface PlaceDraft {
  name: string;
  radius_m: string;
  placeType: PlaceType;
  chargingEnabled: boolean;
  planType: PlanType;
  energyRate: string;
  sessionFee: string;
  timezone: string;
  schedule: ScheduleDraft[];
}

const browserTimezone = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  : 'UTC';

const METERS_TO_FEET = 3.28084;

function emptyDraft(unitSystem: UnitSystem): PlaceDraft {
  return {
    name: '',
    radius_m: unitSystem === 'metric' ? '75' : '250',
    placeType: 'poi',
    chargingEnabled: false,
    planType: 'per_kwh',
    energyRate: '0.13',
    sessionFee: '0',
    timezone: browserTimezone,
    schedule: [{ label: 'All day', start: '00:00', end: '24:00', rate: '0.13' }],
  };
}

function radiusDraftToMeters(value: number, unitSystem: UnitSystem) {
  return unitSystem === 'metric' ? value : value / METERS_TO_FEET;
}

function radiusInputLabel(unitSystem: UnitSystem) {
  return unitSystem === 'metric' ? 'Radius (m)' : 'Radius (ft)';
}

function buildNextSchedule(schedule: ScheduleDraft[]) {
  if (schedule.length === 0) {
    return normalizeScheduleEdges([{ label: 'Period 1', start: '00:00', end: '24:00', rate: '0' }]);
  }

  const nextSchedule = [...schedule];
  const lastIndex = nextSchedule.length - 1;
  const lastPeriod = nextSchedule[lastIndex];
  if (!lastPeriod) {
    return normalizeScheduleEdges([{ label: 'All day', start: '00:00', end: '24:00', rate: '0' }]);
  }
  const startMinute = parseTimeToMinute(lastPeriod.start, false);
  const endMinute = parseTimeToMinute(lastPeriod.end, true);

  if (startMinute !== null && endMinute !== null && endMinute - startMinute >= 120) {
    const splitMinute = Math.max(startMinute + 60, Math.min(endMinute - 60, Math.ceil((startMinute + endMinute) / 120) * 60));
    nextSchedule[lastIndex] = { ...lastPeriod, end: minutesToTime(splitMinute) };
    nextSchedule.push({
      label: `Period ${nextSchedule.length + 1}`,
      start: minutesToTime(splitMinute),
      end: minutesToTime(endMinute),
      rate: lastPeriod.rate || '0',
    });
    return normalizeScheduleEdges(nextSchedule);
  }

  const fallbackStart = lastPeriod.end === '24:00' ? '23:00' : lastPeriod.end;
  nextSchedule.push({
    label: `Period ${nextSchedule.length + 1}`,
    start: fallbackStart,
    end: '24:00',
    rate: lastPeriod.rate || '0',
  });
  return normalizeScheduleEdges(nextSchedule);
}

function normalizeScheduleEdges(schedule: ScheduleDraft[]): ScheduleDraft[] {
  if (schedule.length === 0) {
    return [{ label: 'All day', start: '00:00', end: '24:00', rate: '0' }];
  }

  return schedule.map((period, index): ScheduleDraft => ({
    label: period.label,
    start: index === 0 ? '00:00' : period.start,
    end: index === schedule.length - 1 ? '24:00' : period.end,
    rate: period.rate,
  }));
}

export function PlacesSection({ unitSystem }: { unitSystem: UnitSystem }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<PlaceDraft>(() => emptyDraft(unitSystem));
  const [editingPlaceId, setEditingPlaceId] = React.useState<string | null>(null);
  const [addressQuery, setAddressQuery] = React.useState('');
  const [submittedAddressQuery, setSubmittedAddressQuery] = React.useState('');
  const [autocompleteAddressQuery, setAutocompleteAddressQuery] = React.useState('');
  const [savedPlacesQuery, setSavedPlacesQuery] = React.useState('');
  const [selectedAddress, setSelectedAddress] = React.useState<PlaceAddress | null>(null);
  const connectionPolicy = useQuery({
    queryKey: ['external-connections'],
    queryFn: () => api.getExternalConnections(),
    staleTime: 30_000,
  });
  const nominatimPolicy = connectionPolicy.data?.connections.find((connection) => connection.id === 'nominatim');
  const customAutocomplete = nominatimPolicy?.mode === 'custom' && nominatimPolicy.custom_autocomplete;
  const deferredAddressQuery = React.useDeferredValue(
    (customAutocomplete ? autocompleteAddressQuery : submittedAddressQuery).trim(),
  );
  const deferredSavedPlacesQuery = React.useDeferredValue(savedPlacesQuery.trim().toLowerCase());
  const previousUnitSystem = React.useRef(unitSystem);

  const places = useQuery({
    queryKey: ['places'],
    queryFn: () => api.listPlaces(),
  });

  const addressSearch = useQuery({
    queryKey: ['place-search', deferredAddressQuery],
    queryFn: () => api.searchPlaceAddresses(deferredAddressQuery, 5),
    enabled: deferredAddressQuery.length >= 3,
  });

  const savePlace = useMutation({
    mutationFn: async (body: UpsertPlaceBody) => {
      if (editingPlaceId) {
        return api.updatePlace(editingPlaceId, body);
      }
      return api.createPlace(body);
    },
    onSuccess: () => {
      setEditingPlaceId(null);
      setDraft(emptyDraft(unitSystem));
      setSelectedAddress(null);
      setAddressQuery('');
      setSubmittedAddressQuery('');
      queryClient.invalidateQueries({ queryKey: ['places'] });
    },
  });

  const deletePlace = useMutation({
    mutationFn: (id: string) => api.deletePlace(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['places'] }),
  });

  React.useEffect(() => {
    if (!customAutocomplete) {
      setAutocompleteAddressQuery('');
      return;
    }
    const handle = window.setTimeout(() => setAutocompleteAddressQuery(addressQuery.trim()), 350);
    return () => window.clearTimeout(handle);
  }, [addressQuery, customAutocomplete]);

  React.useEffect(() => {
    if (previousUnitSystem.current === unitSystem) return;

    setDraft((current) => {
      const currentRadius = Number(current.radius_m);
      if (!Number.isFinite(currentRadius) || currentRadius <= 0) {
        return current;
      }

      const meters = radiusDraftToMeters(currentRadius, previousUnitSystem.current);
      return {
        ...current,
        radius_m: String(Math.round(unitSystem === 'metric' ? meters : meters * METERS_TO_FEET)),
      };
    });

    previousUnitSystem.current = unitSystem;
  }, [unitSystem]);

  const scheduleValidation = React.useMemo(() => {
    if (!draft.chargingEnabled || draft.planType !== 'tou') {
      return null;
    }
    return validateScheduleDraft(draft.schedule);
  }, [draft.chargingEnabled, draft.planType, draft.schedule]);

  const addressChangedFromSelection = Boolean(selectedAddress && addressQuery.trim() !== selectedAddress.display_name);
  const chargeRateValid = () => {
    if (!draft.chargingEnabled) return true;
    if (draft.planType === 'per_kwh') {
      return Number.isFinite(Number(draft.energyRate));
    }
    return !scheduleValidation;
  };

  const canSave = selectedAddress
    && draft.name.trim().length > 0
    && Number.isFinite(Number(draft.radius_m))
    && Number(draft.radius_m) > 0
    && !addressChangedFromSelection
    && chargeRateValid();

  const shouldSearchSuggestions = deferredAddressQuery.length >= 3
    && addressQuery.trim() === deferredAddressQuery
    && (!selectedAddress || addressChangedFromSelection);
  const placeSuggestions = shouldSearchSuggestions
    ? (addressSearch.data ?? [])
    : [];
  const isSearchingSuggestions = shouldSearchSuggestions && addressSearch.isFetching;
  const hasNoSuggestions = shouldSearchSuggestions && !isSearchingSuggestions && placeSuggestions.length === 0;
  const filteredPlaces = React.useMemo(() => {
    const allPlaces = places.data ?? [];
    if (!deferredSavedPlacesQuery) {
      return allPlaces;
    }

    return allPlaces.filter((place) => {
      const fields = [
        place.name,
        place.address?.display_name,
        place.address?.city,
        place.address?.state,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return fields.some((field) => field.includes(deferredSavedPlacesQuery));
    });
  }, [places.data, deferredSavedPlacesQuery]);

  function updateDraft<K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateSchedulePeriod(index: number, updates: Partial<ScheduleDraft>, syncNextStart = false) {
    setDraft((current) => {
      const schedule = current.schedule.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...updates } : item
      ));

      if (syncNextStart && index < schedule.length - 1 && updates.end) {
        const nextPeriod = schedule[index + 1];
        if (nextPeriod) {
          schedule[index + 1] = { ...nextPeriod, start: updates.end };
        }
      }

      return { ...current, schedule: normalizeScheduleEdges(schedule) };
    });
  }

  function resetEditor() {
    setEditingPlaceId(null);
    setDraft(emptyDraft(unitSystem));
    setSelectedAddress(null);
    setAddressQuery('');
    setSubmittedAddressQuery('');
  }

  function startEditing(place: Place) {
    setEditingPlaceId(place.id);
    setSelectedAddress(place.address);
    setAddressQuery(place.address?.display_name ?? '');
    setSubmittedAddressQuery('');
    const placeType = place.is_home ? 'home' : place.is_work ? 'work' : 'poi';
    setDraft({
      name: place.name,
      radius_m: String(Math.round(unitSystem === 'metric' ? place.radius_m : place.radius_m * METERS_TO_FEET)),
      placeType,
      chargingEnabled: !!place.charging,
      planType: place.charging?.billing_type === 'tou' ? 'tou' : 'per_kwh',
      energyRate: String(place.charging?.rate ?? 0.13),
      sessionFee: String(place.charging?.session_fee ?? 0),
      timezone: place.charging?.timezone ?? browserTimezone,
      schedule: normalizeScheduleEdges(place.charging?.billing_type === 'tou' && place.charging.tou_periods.length > 0
        ? place.charging.tou_periods.map((period) => ({
            label: period.label,
            start: minutesToTime(period.start_minute),
            end: minutesToTime(period.end_minute),
            rate: String(period.rate),
          }))
        : [{ label: 'All day', start: '00:00', end: '24:00', rate: String(place.charging?.rate ?? 0.13) }]),
    });
  }

  function handleAddressSelect(address: PlaceSearchSuggestion) {
    setSelectedAddress(address);
    setAddressQuery(address.display_name);
    setSubmittedAddressQuery('');
  }

  async function handleSave() {
    if (!selectedAddress) return;

    const charging = buildChargingPayload(draft);
    if (draft.chargingEnabled && draft.planType === 'tou' && !charging) {
      return;
    }

    await savePlace.mutateAsync({
      name: draft.name.trim(),
      radius_m: radiusDraftToMeters(Number(draft.radius_m || '0'), unitSystem),
      is_home: draft.placeType === 'home',
      is_work: draft.placeType === 'work',
      address: selectedAddress,
      charging,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{editingPlaceId ? 'Edit Place' : 'Places'}</CardTitle>
          <Button variant="secondary" size="sm" onClick={resetEditor}>
            {editingPlaceId ? 'New Place' : 'Reset'}
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="grid min-w-0 gap-4">
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Place Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                  placeholder="Home garage"
                  className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>

              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,8.5rem)] sm:items-end">
                <label className="grid min-w-0 gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Address Search</span>
                  <input
                    value={addressQuery}
                    onChange={(event) => {
                      setAddressQuery(event.target.value);
                      if (selectedAddress?.display_name !== event.target.value) {
                        setSelectedAddress(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && addressQuery.trim().length >= 3) {
                        event.preventDefault();
                        setSubmittedAddressQuery(addressQuery.trim());
                      }
                    }}
                    placeholder="Enter an address"
                    className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  />
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9"
                  disabled={addressQuery.trim().length < 3}
                  onClick={() => setSubmittedAddressQuery(addressQuery.trim())}
                >
                  <Search className="h-4 w-4" />
                  Search
                </Button>
                <label className="grid gap-1 sm:min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{radiusInputLabel(unitSystem)}</span>
                  <input
                    value={draft.radius_m}
                    onChange={(event) => updateDraft('radius_m', event.target.value)}
                    inputMode="numeric"
                    className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  />
                </label>
              </div>

              <p className="-mt-2 text-xs text-fg-tertiary">
                {customAutocomplete
                  ? 'This self-hosted provider allows address suggestions while you type.'
                  : 'Address text is sent to the configured provider only when you choose Search.'}
              </p>

              {(shouldSearchSuggestions && (isSearchingSuggestions || placeSuggestions.length > 0 || hasNoSuggestions)) && (
                <div className="rounded-lg border border-border bg-bg-elevated/50 p-2">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">Suggestions</div>
                  <div className="grid gap-2">
                    {isSearchingSuggestions && (
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg-tertiary">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        <span>Searching addresses...</span>
                      </div>
                    )}
                    {placeSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.osm_id ?? suggestion.display_name}-${suggestion.latitude}-${suggestion.longitude}`}
                        type="button"
                        onClick={() => handleAddressSelect(suggestion)}
                        className="rounded-lg border border-border bg-bg px-3 py-2 text-left text-sm text-fg transition-colors hover:border-accent"
                      >
                        <div>{suggestion.display_name}</div>
                        <div className="mt-1 text-xs text-fg-tertiary">
                          {[suggestion.city, suggestion.state, suggestion.postcode].filter(Boolean).join(' • ') || 'OpenStreetMap result'}
                        </div>
                      </button>
                    ))}
                    {hasNoSuggestions && (
                      <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg-tertiary">
                        No matching addresses found. Try a broader search.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedAddress && (
                <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm text-fg">
                  <div className="font-medium">Selected Address</div>
                  <div className="mt-1 text-fg-tertiary">{selectedAddress.display_name}</div>
                </div>
              )}

              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Place Type</span>
                  <SelectPicker
                    className="w-full"
                    value={draft.placeType}
                    onChange={(value) => updateDraft('placeType', value as PlaceType)}
                    aria-label="Place type"
                    options={[{ value: 'poi', label: 'Point of Interest' }, { value: 'home', label: 'Home' }, { value: 'work', label: 'Work' }]}
                  />
                </label>

                <button
                  type="button"
                  aria-pressed={draft.chargingEnabled}
                  onClick={() => updateDraft('chargingEnabled', !draft.chargingEnabled)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${draft.chargingEnabled
                    ? 'border-accent bg-accent/12 text-fg'
                    : 'border-border bg-bg-elevated/50 text-fg hover:border-border-strong'}`}
                >
                  <div>
                    <div className="text-sm font-medium">Charging Rates</div>
                    <div className="text-xs text-fg-tertiary">Turn on pricing for this place</div>
                  </div>
                  <span
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${draft.chargingEnabled ? 'bg-accent' : 'bg-bg-elevated border border-border'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft.chargingEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                    />
                  </span>
                </button>
              </div>

              {draft.chargingEnabled && (
                <div className="grid gap-4 rounded-xl border border-border bg-bg-elevated/40 p-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-fg">
                      <Plus className="h-4 w-4" />
                      Charging Rates
                    </div>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Per-kWh pricing charges for energy added at this place. Time-of-Use (TOU) pricing requires contiguous periods that cover the full day in the selected timezone.
                    </p>
                  </div>

                  <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                    <label className="grid gap-1 sm:min-w-0">
                      <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Pricing Type</span>
                      <SelectPicker
                        className="w-full"
                        value={draft.planType}
                        onChange={(value) => updateDraft('planType', value as PlanType)}
                        aria-label="Pricing type"
                        options={[{ value: 'per_kwh', label: 'Per kWh' }, { value: 'tou', label: 'Time-of-Use' }]}
                      />
                    </label>
                    {draft.planType === 'per_kwh' && (
                      <label className="grid gap-1 sm:min-w-0">
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Rate ($/kWh)</span>
                          <input
                            value={draft.energyRate}
                            onChange={(event) => updateDraft('energyRate', event.target.value)}
                            inputMode="decimal"
                            placeholder="0.13"
                            className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                          />
                        </label>
                    )}
                  </div>

                  {draft.planType === 'per_kwh' && (
                    <label className="grid gap-1 sm:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Session Fee</span>
                        <div className="group relative">
                          <HelpCircle className="h-3.5 w-3.5 cursor-help text-fg-tertiary" />
                          <div className="absolute bottom-full right-0 z-10 mb-2 hidden whitespace-nowrap rounded-lg border border-border bg-bg-elevated px-2 py-1 text-xs text-fg group-hover:block">
                            One-time charge per charging session
                          </div>
                        </div>
                      </div>
                      <input
                        value={draft.sessionFee}
                        onChange={(event) => updateDraft('sessionFee', event.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                      />
                    </label>
                  )}

                  {draft.planType === 'tou' && (
                    <div className="grid gap-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
                        <label className="grid gap-1 min-w-0">
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Timezone</span>
                          <input
                            value={draft.timezone}
                            onChange={(event) => updateDraft('timezone', event.target.value)}
                            className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                          />
                        </label>
                        <label className="grid gap-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Session Fee</span>
                            <div className="group relative">
                              <HelpCircle className="h-3.5 w-3.5 cursor-help text-fg-tertiary" />
                              <div className="absolute bottom-full right-0 z-10 mb-2 hidden whitespace-nowrap rounded-lg border border-border bg-bg-elevated px-2 py-1 text-xs text-fg group-hover:block">
                                One-time charge per charging session
                              </div>
                            </div>
                          </div>
                          <input
                            value={draft.sessionFee}
                            onChange={(event) => updateDraft('sessionFee', event.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                          />
                        </label>
                      </div>

                      <div>
                        <Button
                          variant="secondary"
                          size="md"
                          className="h-9"
                          iconLeft={<Plus className="h-3.5 w-3.5" />}
                          onClick={() => updateDraft('schedule', buildNextSchedule(draft.schedule))}
                        >
                          Add Period
                        </Button>
                      </div>

                      <div className="grid gap-2">
                        <div className="hidden gap-2 px-3 xl:grid xl:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem]">
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Label</span>
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Start</span>
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">End</span>
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Rate ($/kWh)</span>
                          <span />
                        </div>
                        {draft.schedule.map((period, index) => (
                          <div key={`period-${index}`} className="grid min-w-0 gap-2 rounded-lg border border-border bg-bg p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_7rem]">
                            <input
                              value={period.label}
                              onChange={(event) => updateSchedulePeriod(index, { label: event.target.value })}
                              placeholder="Peak"
                              className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent xl:col-auto"
                            />
                            <input
                              value={period.start}
                              onChange={(event) => updateSchedulePeriod(index, { start: event.target.value })}
                              placeholder="00:00"
                              disabled={index === 0}
                              className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              value={index === draft.schedule.length - 1 ? '00:00' : period.end}
                              onChange={(event) => updateSchedulePeriod(index, { end: event.target.value }, true)}
                              placeholder="24:00"
                              disabled={index === draft.schedule.length - 1}
                              className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
                            />
                            <input
                              value={period.rate}
                              onChange={(event) => updateSchedulePeriod(index, { rate: event.target.value })}
                              inputMode="decimal"
                              placeholder="0.13"
                              className="h-9 w-full min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                            />
                            <Button
                              variant="danger"
                              size="md"
                              className="h-9"
                              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => updateDraft('schedule', normalizeScheduleEdges(draft.schedule.filter((_, itemIndex) => itemIndex !== index)))}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>

                      <div className="text-xs text-fg-tertiary">
                        The first period always starts at 00:00, and the final period always ends at midnight so the full day stays covered.
                      </div>

                      {scheduleValidation && (
                        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                          {scheduleValidation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {addressChangedFromSelection && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
                  Pick one of the address suggestions again before saving this place.
                </div>
              )}

              <div className="flex gap-3">
                <Button size="sm" loading={savePlace.isPending} disabled={!canSave} onClick={() => void handleSave()}>
                  {editingPlaceId ? 'Save Place' : 'Create Place'}
                </Button>
                {editingPlaceId && (
                  <Button variant="secondary" size="sm" onClick={resetEditor}>Cancel</Button>
                )}
              </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Places</CardTitle>
          <div className="flex min-w-0 items-center gap-2">
            <label className="sr-only" htmlFor="saved-places-search">Search saved places</label>
            <input
              id="saved-places-search"
              type="search"
              value={savedPlacesQuery}
              onChange={(event) => setSavedPlacesQuery(event.target.value)}
              placeholder="Search saved places"
              className="h-8 w-40 min-w-0 rounded-lg border border-border bg-bg-elevated px-3 text-xs text-fg outline-none focus:border-accent sm:w-56"
            />
            <Badge variant="default">{filteredPlaces.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {filteredPlaces.map((place) => (
              <div key={place.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/30 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{place.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {place.is_home && (
                      <Badge variant="success" className="inline-flex items-center gap-1 text-xs">
                        <Home className="h-3 w-3" />
                        Home
                      </Badge>
                    )}
                    {place.is_work && <Badge variant="default" className="text-xs">Work</Badge>}
                    {!place.is_home && !place.is_work && <Badge variant="default" className="text-xs">POI</Badge>}
                    {place.charging && (
                      <Badge variant="default" className="inline-flex items-center gap-1 text-xs">
                        <Zap className="h-3 w-3" />
                        Charging Rates
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <Button variant="secondary" size="sm" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => startEditing(place)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" iconLeft={<Trash2 className="h-3.5 w-3.5" />} loading={deletePlace.isPending} onClick={() => deletePlace.mutate(place.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}

            {(places.data?.length ?? 0) === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-fg-tertiary">
                No saved places yet. Add home, work, or favorite chargers here.
              </div>
            )}

            {(places.data?.length ?? 0) > 0 && filteredPlaces.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-fg-tertiary">
                No saved places match your search.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function buildChargingPayload(draft: PlaceDraft): PlaceChargingInput | null {
  if (!draft.chargingEnabled) {
    return null;
  }

  const rate = Number(draft.energyRate || '0');
  const sessionFee = Number(draft.sessionFee || '0');

  if (draft.planType === 'per_kwh') {
    return {
      billing_type: 'per_kwh',
      rate,
      session_fee: sessionFee,
      currency: 'USD',
    };
  }

  const periods = scheduleDraftToPeriods(draft.schedule);
  if (!periods) {
    return null;
  }

  return {
    billing_type: 'tou',
    rate,
    session_fee: sessionFee,
    currency: 'USD',
    timezone: draft.timezone.trim() || browserTimezone,
    tou_periods: periods,
  };
}

function scheduleDraftToPeriods(schedule: ScheduleDraft[]): TouPeriod[] | null {
  const periods: TouPeriod[] = [];
  for (const item of schedule) {
    const start = parseTimeToMinute(item.start, false);
    const end = parseTimeToMinute(item.end, true);
    const rate = Number(item.rate);

    if (start === null || end === null || !Number.isFinite(rate)) {
      return null;
    }

    periods.push({
      label: item.label.trim(),
      start_minute: start,
      end_minute: end,
      rate,
    });
  }
  return periods;
}

function validateScheduleDraft(schedule: ScheduleDraft[]) {
  const periods = scheduleDraftToPeriods(schedule);
  if (!periods || periods.length === 0) {
    return 'Each TOU period needs a valid start, end, and rate.';
  }

  let expectedStart = 0;
  for (const period of periods) {
    if (!period.label) {
      return 'Each TOU period needs a label.';
    }
    if (period.start_minute !== expectedStart) {
      return 'TOU periods must be contiguous and begin at 00:00.';
    }
    if (period.end_minute <= period.start_minute) {
      return 'Each TOU period must end after it starts.';
    }
    if (period.rate < 0) {
      return 'Each TOU period needs a non-negative rate.';
    }
    expectedStart = period.end_minute;
  }

  if (expectedStart !== 24 * 60) {
    return 'TOU periods must cover the entire day through midnight.';
  }

  return null;
}

function parseTimeToMinute(value: string, allow24Hour: boolean) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (allow24Hour && hour === 24 && minute === 0) {
    return 24 * 60;
  }
  if (hour < 0 || hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

function minutesToTime(minutes: number) {
  if (minutes >= 24 * 60) {
    return '24:00';
  }
  const hour = Math.floor(minutes / 60).toString().padStart(2, '0');
  const minute = (minutes % 60).toString().padStart(2, '0');
  return `${hour}:${minute}`;
}
