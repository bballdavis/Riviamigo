import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { Place, PlaceAddress, PlaceChargingInput, PlaceSearchSuggestion, TouPeriod, UpsertPlaceBody } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';
import { Pencil, Plus, Trash2 } from 'lucide-react';

type PlanType = 'flat' | 'tou';

interface ScheduleDraft {
  label: string;
  start: string;
  end: string;
  rate: string;
}

interface PlaceDraft {
  name: string;
  radius_m: string;
  is_home: boolean;
  is_work: boolean;
  chargingEnabled: boolean;
  planType: PlanType;
  flatRate: string;
  sessionFee: string;
  timezone: string;
  schedule: ScheduleDraft[];
}

const browserTimezone = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  : 'UTC';

const emptyDraft = (): PlaceDraft => ({
  name: '',
  radius_m: '75',
  is_home: false,
  is_work: false,
  chargingEnabled: false,
  planType: 'flat',
  flatRate: '0.13',
  sessionFee: '0',
  timezone: browserTimezone,
  schedule: [{ label: 'All day', start: '00:00', end: '24:00', rate: '0.13' }],
});

export function PlacesSection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<PlaceDraft>(() => emptyDraft());
  const [editingPlaceId, setEditingPlaceId] = React.useState<string | null>(null);
  const [addressQuery, setAddressQuery] = React.useState('');
  const [selectedAddress, setSelectedAddress] = React.useState<PlaceAddress | null>(null);
  const deferredAddressQuery = React.useDeferredValue(addressQuery.trim());

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
      setDraft(emptyDraft());
      setSelectedAddress(null);
      setAddressQuery('');
      queryClient.invalidateQueries({ queryKey: ['places'] });
    },
  });

  const deletePlace = useMutation({
    mutationFn: (id: string) => api.deletePlace(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['places'] }),
  });

  const scheduleValidation = React.useMemo(() => {
    if (!draft.chargingEnabled || draft.planType !== 'tou') {
      return null;
    }
    return validateScheduleDraft(draft.schedule);
  }, [draft.chargingEnabled, draft.planType, draft.schedule]);

  const addressChangedFromSelection = selectedAddress && addressQuery.trim() !== selectedAddress.display_name;
  const canSave = selectedAddress
    && draft.name.trim().length > 0
    && !addressChangedFromSelection
    && (!draft.chargingEnabled || draft.flatRate.trim().length > 0)
    && (!draft.chargingEnabled || draft.planType !== 'tou' || !scheduleValidation);

  const placeSuggestions = addressChangedFromSelection ? (addressSearch.data ?? []) : [];

  function updateDraft<K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetEditor() {
    setEditingPlaceId(null);
    setDraft(emptyDraft());
    setSelectedAddress(null);
    setAddressQuery('');
  }

  function startEditing(place: Place) {
    setEditingPlaceId(place.id);
    setSelectedAddress(place.address);
    setAddressQuery(place.address?.display_name ?? '');
    setDraft({
      name: place.name,
      radius_m: String(place.radius_m ?? 75),
      is_home: place.is_home,
      is_work: place.is_work,
      chargingEnabled: !!place.charging,
      planType: place.charging?.billing_type === 'tou' ? 'tou' : 'flat',
      flatRate: String(place.charging?.rate ?? 0.13),
      sessionFee: String(place.charging?.session_fee ?? 0),
      timezone: place.charging?.timezone ?? browserTimezone,
      schedule: place.charging?.billing_type === 'tou' && place.charging.tou_periods.length > 0
        ? place.charging.tou_periods.map((period) => ({
            label: period.label,
            start: minutesToTime(period.start_minute),
            end: minutesToTime(period.end_minute),
            rate: String(period.rate),
          }))
        : [{ label: 'All day', start: '00:00', end: '24:00', rate: String(place.charging?.rate ?? 0.13) }],
    });
  }

  function handleAddressSelect(address: PlaceSearchSuggestion) {
    setSelectedAddress(address);
    setAddressQuery(address.display_name);
  }

  async function handleSave() {
    if (!selectedAddress) return;

    const charging = buildChargingPayload(draft);
    if (draft.chargingEnabled && draft.planType === 'tou' && !charging) {
      return;
    }

    await savePlace.mutateAsync({
      name: draft.name.trim(),
      radius_m: Number(draft.radius_m || '75'),
      is_home: draft.is_home,
      is_work: draft.is_work,
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
        <CardContent>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="grid gap-4">
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Place Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                  placeholder="Home garage"
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="grid gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Address Search</span>
                  <input
                    value={addressQuery}
                    onChange={(event) => {
                      setAddressQuery(event.target.value);
                      if (selectedAddress?.display_name !== event.target.value) {
                        setSelectedAddress(null);
                      }
                    }}
                    placeholder="Start typing an address"
                    className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Radius (m)</span>
                  <input
                    value={draft.radius_m}
                    onChange={(event) => updateDraft('radius_m', event.target.value)}
                    inputMode="numeric"
                    className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  />
                </label>
              </div>

              {placeSuggestions.length > 0 && (
                <div className="rounded-lg border border-border bg-bg-elevated/50 p-2">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">Suggestions</div>
                  <div className="grid gap-2">
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
                  </div>
                </div>
              )}

              {selectedAddress && (
                <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm text-fg">
                  <div className="font-medium">Selected Address</div>
                  <div className="mt-1 text-fg-tertiary">{selectedAddress.display_name}</div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 text-sm text-fg">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={draft.is_home} onChange={(event) => updateDraft('is_home', event.target.checked)} />
                  <span>Mark as home</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={draft.is_work} onChange={(event) => updateDraft('is_work', event.target.checked)} />
                  <span>Mark as work</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={draft.chargingEnabled} onChange={(event) => updateDraft('chargingEnabled', event.target.checked)} />
                  <span>Attach charging pricing</span>
                </label>
              </div>

              {draft.chargingEnabled && (
                <div className="grid gap-4 rounded-xl border border-border bg-bg-elevated/40 p-4">
                  <div>
                    <div className="text-sm font-medium text-fg">Charging Cost Setup</div>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Flat pricing charges one fixed amount per session. TOU pricing requires contiguous periods that cover the full day in the selected timezone.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[12rem_10rem_10rem]">
                    <label className="grid gap-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Pricing Type</span>
                      <select
                        value={draft.planType}
                        onChange={(event) => updateDraft('planType', event.target.value as PlanType)}
                        className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-accent"
                      >
                        <option value="flat">Flat</option>
                        <option value="tou">TOU</option>
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Rate</span>
                      <input
                        value={draft.flatRate}
                        onChange={(event) => updateDraft('flatRate', event.target.value)}
                        inputMode="decimal"
                        className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-accent"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Session Fee</span>
                      <input
                        value={draft.sessionFee}
                        onChange={(event) => updateDraft('sessionFee', event.target.value)}
                        inputMode="decimal"
                        className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-accent"
                      />
                    </label>
                  </div>

                  {draft.planType === 'tou' && (
                    <div className="grid gap-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <label className="grid gap-1">
                          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Timezone</span>
                          <input
                            value={draft.timezone}
                            onChange={(event) => updateDraft('timezone', event.target.value)}
                            className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-accent"
                          />
                        </label>
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<Plus className="h-3.5 w-3.5" />}
                          onClick={() => updateDraft('schedule', [...draft.schedule, { label: `Period ${draft.schedule.length + 1}`, start: '00:00', end: '24:00', rate: draft.flatRate || '0.13' }])}
                        >
                          Add Period
                        </Button>
                      </div>

                      <div className="grid gap-2">
                        {draft.schedule.map((period, index) => (
                          <div key={`${index}-${period.label}`} className="grid gap-2 rounded-lg border border-border bg-bg p-3 md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_auto]">
                            <input
                              value={period.label}
                              onChange={(event) => setDraft((current) => ({
                                ...current,
                                schedule: current.schedule.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
                              }))}
                              placeholder="Peak"
                              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                            />
                            <input
                              value={period.start}
                              onChange={(event) => setDraft((current) => ({
                                ...current,
                                schedule: current.schedule.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item),
                              }))}
                              placeholder="00:00"
                              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                            />
                            <input
                              value={period.end}
                              onChange={(event) => setDraft((current) => ({
                                ...current,
                                schedule: current.schedule.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item),
                              }))}
                              placeholder="24:00"
                              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                            />
                            <input
                              value={period.rate}
                              onChange={(event) => setDraft((current) => ({
                                ...current,
                                schedule: current.schedule.map((item, itemIndex) => itemIndex === index ? { ...item, rate: event.target.value } : item),
                              }))}
                              inputMode="decimal"
                              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                            />
                            <Button
                              variant="danger"
                              size="sm"
                              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => updateDraft('schedule', draft.schedule.filter((_, itemIndex) => itemIndex !== index))}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
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

            <div className="rounded-xl border border-border bg-bg-elevated/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-fg">Saved Places</div>
                  <div className="text-xs text-fg-tertiary">Addresses, geofence radius, and charging plans live together here.</div>
                </div>
                <Badge variant="default">{places.data?.length ?? 0}</Badge>
              </div>

              <div className="grid gap-3">
                {(places.data ?? []).map((place) => (
                  <div key={place.id} className="rounded-lg border border-border bg-bg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-fg">{place.name}</div>
                        <div className="mt-1 text-xs text-fg-tertiary">{place.address?.display_name ?? 'Address pending'}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" iconLeft={<Pencil className="h-3.5 w-3.5" />} onClick={() => startEditing(place)}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" iconLeft={<Trash2 className="h-3.5 w-3.5" />} loading={deletePlace.isPending} onClick={() => deletePlace.mutate(place.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-fg-tertiary">
                      <Badge variant="default">{Math.round(place.radius_m)} m radius</Badge>
                      {place.is_home && <Badge variant="success">Home</Badge>}
                      {place.is_work && <Badge variant="default">Work</Badge>}
                      {place.charging && (
                        <Badge variant="default">
                          {place.charging.billing_type === 'tou'
                            ? `TOU ${place.charging.timezone ?? 'UTC'}`
                            : `Flat ${place.charging.currency} ${place.charging.rate.toFixed(2)}`}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}

                {(places.data?.length ?? 0) === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-fg-tertiary">
                    No saved places yet. Add home, work, or favorite chargers here.
                  </div>
                )}
              </div>
            </div>
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

  const rate = Number(draft.flatRate || '0');
  const sessionFee = Number(draft.sessionFee || '0');

  if (draft.planType === 'flat') {
    return {
      billing_type: 'flat',
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
    return 'TOU periods must cover the entire day through 24:00.';
  }

  return null;
}

function parseTimeToMinute(value: string, allow24Hour: boolean) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
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