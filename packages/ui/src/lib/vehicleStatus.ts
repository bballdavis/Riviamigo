import type {
  VehicleStatus,
  VehicleStatusAvailabilityReason,
  VehicleStatusAvailabilityState,
  VehicleStatusFieldAvailability,
} from '@riviamigo/types';

export type StatusTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusAvailabilitySummary {
  availability: VehicleStatusAvailabilityState;
  reasonCode: VehicleStatusAvailabilityReason | null;
  lastSeenAt: string | null;
  latestEventAt: string | null;
  everSeen: boolean;
}

export interface PresentedVehicleStatusValue {
  label: string;
  variant: StatusTone;
  availability: StatusAvailabilitySummary;
  tooltip: string | null;
  lastUpdatedLabel: string | null;
  secondaryText: string | null;
  renderUnavailableChip: boolean;
}

const DEFINITION_FIELDS: Record<string, string[]> = {
  hv_thermal: ['hv_thermal_event'],
  twelve_volt_health: ['twelve_volt_health'],
  ota_current_version: ['ota_current_version'],
  ota_available_version: ['ota_available_version'],
  charge_port_open: ['charge_port_open'],
  charger_derate_active: ['charger_derate_active'],
  cabin_precon: ['cabin_precon_status', 'cabin_precon_type'],
  defrost_active: ['defrost_active'],
  pet_mode: ['pet_mode_active', 'pet_mode_temp_ok'],
  seat_fl_heat: ['seat_fl_heat'],
  seat_fr_heat: ['seat_fr_heat'],
  seat_rl_heat: ['seat_rl_heat'],
  seat_rr_heat: ['seat_rr_heat'],
  seat_fl_vent: ['seat_fl_vent'],
  seat_fr_vent: ['seat_fr_vent'],
  steering_wheel_heat: ['steering_wheel_heat'],
  tonneau_status: ['tonneau_closed', 'tonneau_locked'],
  gear_guard_locked: ['gear_guard_locked', 'gear_guard_video_status'],
  brake_fluid_warning: ['brake_fluid_low'],
  wiper_fluid_warning: ['wiper_fluid_low'],
  alarm_status: ['alarm_active'],
  service_mode: ['service_mode'],
  window_status: [
    'window_fl_closed',
    'window_fr_closed',
    'window_rl_closed',
    'window_rr_closed',
  ],
};

export function getStatusDefinitionFields(definitionId: string): string[] {
  return DEFINITION_FIELDS[definitionId] ?? [];
}

export function summarizeStatusAvailability(
  status: VehicleStatus | null | undefined,
  fields: string[],
): StatusAvailabilitySummary {
  const entries = fields
    .map((field) => status?.field_availability?.[field])
    .filter((entry): entry is VehicleStatusFieldAvailability => !!entry);

  const latestEventAt = entries.find((entry) => entry.latest_event_at)?.latest_event_at ?? null;
  const lastSeenAt = maxIso(entries.map((entry) => entry.last_seen_at));
  const everSeen = entries.some((entry) => entry.ever_seen);
  const hasCurrent = entries.some((entry) => entry.availability === 'current');
  const hasHistorical = entries.some((entry) => entry.availability === 'historical');
  const hasInvalidSensor = entries.some((entry) => entry.reason_code === 'invalid_sensor');

  const availability: VehicleStatusAvailabilityState = hasCurrent
    ? 'current'
    : hasHistorical
      ? 'historical'
      : 'never_seen';

  const reasonCode: VehicleStatusAvailabilityReason | null = hasInvalidSensor
    ? 'invalid_sensor'
    : availability === 'historical'
      ? 'missing_recent_payload'
      : availability === 'never_seen'
        ? 'never_seen'
        : null;

  return {
    availability,
    reasonCode,
    lastSeenAt,
    latestEventAt,
    everSeen,
  };
}

export function buildAvailabilityTooltip(
  label: string,
  availability: StatusAvailabilitySummary,
): string | null {
  if (availability.reasonCode === 'invalid_sensor') {
    return `${label} is currently unavailable because Rivian marked the sensor as invalid.`;
  }
  if (availability.availability === 'historical' && availability.lastSeenAt) {
    return `${label} is showing the last known value from ${formatDateTimeShort(availability.lastSeenAt)} because the latest vehicle event did not include a new reading.`;
  }
  if (availability.availability === 'never_seen') {
    return `${label} is unavailable because Riviamigo has not stored a reading for this field yet. This may mean the vehicle has not emitted it or Rivian does not expose it for this model.`;
  }
  return null;
}

export function formatAvailabilityLastUpdated(
  availability: StatusAvailabilitySummary,
): string | null {
  if (availability.availability !== 'historical' || !availability.lastSeenAt) return null;
  return `Last updated ${formatDateTimeShort(availability.lastSeenAt)}`;
}

export function presentVehicleStatusDefinition(
  definitionId: string,
  status: VehicleStatus | null | undefined,
): PresentedVehicleStatusValue {
  const availability = summarizeStatusAvailability(status, getStatusDefinitionFields(definitionId));
  const tooltip = buildAvailabilityTooltip(getStatusLabel(definitionId), availability);
  const unavailableBase = {
    label: availability.reasonCode === 'invalid_sensor' ? 'Invalid Sensor' : 'Unavailable',
    variant: 'info' as const,
    availability,
    tooltip,
    lastUpdatedLabel: formatAvailabilityLastUpdated(availability),
    secondaryText: null,
    renderUnavailableChip: true,
  };

  if (availability.reasonCode === 'invalid_sensor') {
    return unavailableBase;
  }

  switch (definitionId) {
    case 'hv_thermal': {
      const value = status?.hv_thermal_event;
      if (!value) return unavailableBase;
      if (/fault|fail|critical|error|overheat|warning/i.test(value)) {
        return presentResolvedStatus('Warning', 'warning', availability, tooltip);
      }
      if (/^(off|none|inactive|normal|ok|good)$/i.test(value)) {
        return presentResolvedStatus('Nominal', 'success', availability, tooltip);
      }
      return presentResolvedStatus(titleCase(value), 'warning', availability, tooltip);
    }
    case 'twelve_volt_health': {
      const value = status?.twelve_volt_health;
      if (!value) return unavailableBase;
      if (/normal|good|ok/i.test(value)) {
        return presentResolvedStatus(titleCase(value), 'success', availability, tooltip);
      }
      if (/critical|fault|fail/i.test(value)) {
        return presentResolvedStatus(titleCase(value), 'danger', availability, tooltip);
      }
      return presentResolvedStatus(titleCase(value), 'warning', availability, tooltip);
    }
    case 'ota_current_version': {
      const value = status?.ota_current_version;
      return value
        ? presentResolvedStatus(value, 'default', availability, tooltip)
        : unavailableBase;
    }
    case 'ota_available_version': {
      const value = status?.ota_available_version;
      return value
        ? presentResolvedStatus(value, 'info', availability, tooltip)
        : unavailableBase;
    }
    case 'charge_port_open':
      return presentBoolLikeStatus(
        status?.charge_port_open,
        availability,
        tooltip,
        { active: 'Open', inactive: 'Closed', activeTone: 'warning', inactiveTone: 'success' },
      );
    case 'charger_derate_active':
      return presentBoolLikeStatus(
        status?.charger_derate_active,
        availability,
        tooltip,
        { active: 'Active', inactive: 'Off', activeTone: 'warning', inactiveTone: 'success' },
      );
    case 'cabin_precon': {
      const value = status?.cabin_precon_status;
      if (!value) return unavailableBase;
      const inactive = /off|none|inactive/i.test(value);
      return {
        ...presentResolvedStatus(
          inactive ? titleCase(value) : titleCase(value),
          inactive ? 'success' : 'info',
          availability,
          tooltip,
        ),
        secondaryText: status?.cabin_precon_type ? titleCase(status.cabin_precon_type) : null,
      };
    }
    case 'defrost_active':
      return presentBoolLikeStatus(
        status?.defrost_active,
        availability,
        tooltip,
        { active: 'Active', inactive: 'Off', activeTone: 'info', inactiveTone: 'success' },
      );
    case 'pet_mode': {
      const presented = presentBoolLikeStatus(
        status?.pet_mode_active,
        availability,
        tooltip,
        { active: 'Active', inactive: 'Off', activeTone: 'info', inactiveTone: 'success' },
      );
      if (presented.renderUnavailableChip) return presented;
      const tempOk = normalizeBoolLike(status?.pet_mode_temp_ok);
      return {
        ...presented,
        secondaryText:
          tempOk === null ? null : `Temp ${tempOk ? 'OK' : 'Check'}`,
      };
    }
    case 'seat_fl_heat':
    case 'seat_fr_heat':
    case 'seat_rl_heat':
    case 'seat_rr_heat':
    case 'seat_fl_vent':
    case 'seat_fr_vent':
    case 'steering_wheel_heat':
      return presentLevelStatus(readStatusNumber(status, definitionId), availability, tooltip);
    case 'tonneau_status': {
      const closed = status?.tonneau_closed;
      const locked = status?.tonneau_locked;
      const presented = presentClosedStatus(closed, availability, tooltip);
      if (presented.renderUnavailableChip) return presented;
      return {
        ...presented,
        secondaryText:
          locked === null || locked === undefined ? null : `Locked: ${locked ? 'Yes' : 'No'}`,
      };
    }
    case 'gear_guard_locked': {
      const presented = presentBoolLikeStatus(
        status?.gear_guard_locked,
        availability,
        tooltip,
        { active: 'Locked', inactive: 'Unlocked', activeTone: 'success', inactiveTone: 'warning' },
      );
      if (presented.renderUnavailableChip) return presented;
      return {
        ...presented,
        secondaryText: status?.gear_guard_video_status ? titleCase(status.gear_guard_video_status) : null,
      };
    }
    case 'brake_fluid_warning':
      return presentBoolLikeStatus(
        status?.brake_fluid_low,
        availability,
        tooltip,
        { active: 'Warning', inactive: 'OK', activeTone: 'warning', inactiveTone: 'success' },
      );
    case 'wiper_fluid_warning':
      return presentBoolLikeStatus(
        status?.wiper_fluid_low,
        availability,
        tooltip,
        { active: 'Warning', inactive: 'OK', activeTone: 'warning', inactiveTone: 'success' },
      );
    case 'alarm_status':
      return presentBoolLikeStatus(
        status?.alarm_active,
        availability,
        tooltip,
        { active: 'Triggered', inactive: 'Armed', activeTone: 'danger', inactiveTone: 'success' },
      );
    case 'service_mode':
      return presentBoolLikeStatus(
        status?.service_mode,
        availability,
        tooltip,
        { active: 'In Service', inactive: 'OK', activeTone: 'warning', inactiveTone: 'success' },
      );
    case 'window_status': {
      const values = [
        status?.window_fl_closed,
        status?.window_fr_closed,
        status?.window_rl_closed,
        status?.window_rr_closed,
      ];
      const known = values.filter((value): value is boolean => typeof value === 'boolean');
      const open = known.filter((value) => value === false).length;
      if (known.length === 0) return unavailableBase;
      if (open > 0) {
        return presentResolvedStatus(
          `${open} open`,
          'warning',
          availability,
          tooltip,
        );
      }
      return presentResolvedStatus(
        known.length === 4 ? 'Closed' : `${known.length}/4 closed`,
        known.length === 4 ? 'success' : 'info',
        availability,
        tooltip,
      );
    }
    default:
      return unavailableBase;
  }
}

function presentResolvedStatus(
  label: string,
  variant: StatusTone,
  availability: StatusAvailabilitySummary,
  tooltip: string | null,
): PresentedVehicleStatusValue {
  return {
    label,
    variant,
    availability,
    tooltip,
    lastUpdatedLabel: formatAvailabilityLastUpdated(availability),
    secondaryText: null,
    renderUnavailableChip: false,
  };
}

function presentBoolLikeStatus(
  value: boolean | string | null | undefined,
  availability: StatusAvailabilitySummary,
  tooltip: string | null,
  labels: {
    active: string;
    inactive: string;
    activeTone: StatusTone;
    inactiveTone: StatusTone;
  },
): PresentedVehicleStatusValue {
  const normalized = normalizeBoolLike(value);
  if (normalized === null) {
    return {
      label: availability.reasonCode === 'invalid_sensor' ? 'Invalid Sensor' : 'Unavailable',
      variant: 'info',
      availability,
      tooltip,
      lastUpdatedLabel: formatAvailabilityLastUpdated(availability),
      secondaryText: null,
      renderUnavailableChip: true,
    };
  }
  return presentResolvedStatus(
    normalized ? labels.active : labels.inactive,
    normalized ? labels.activeTone : labels.inactiveTone,
    availability,
    tooltip,
  );
}

function presentLevelStatus(
  value: number | null,
  availability: StatusAvailabilitySummary,
  tooltip: string | null,
): PresentedVehicleStatusValue {
  if (value === null) {
    return {
      label: availability.reasonCode === 'invalid_sensor' ? 'Invalid Sensor' : 'Unavailable',
      variant: 'info',
      availability,
      tooltip,
      lastUpdatedLabel: formatAvailabilityLastUpdated(availability),
      secondaryText: null,
      renderUnavailableChip: true,
    };
  }
  if (value <= 0) return presentResolvedStatus('Off', 'success', availability, tooltip);
  return presentResolvedStatus(`Level ${value}`, 'info', availability, tooltip);
}

function presentClosedStatus(
  value: boolean | null | undefined,
  availability: StatusAvailabilitySummary,
  tooltip: string | null,
): PresentedVehicleStatusValue {
  const normalized = normalizeBoolLike(value);
  if (normalized === null) {
    return {
      label: 'Unavailable',
      variant: 'info',
      availability,
      tooltip,
      lastUpdatedLabel: formatAvailabilityLastUpdated(availability),
      secondaryText: null,
      renderUnavailableChip: true,
    };
  }
  return presentResolvedStatus(
    normalized ? 'Closed' : 'Open',
    normalized ? 'success' : 'warning',
    availability,
    tooltip,
  );
}

function getStatusLabel(definitionId: string) {
  const title = definitionId.replace(/_/g, ' ');
  return titleCase(title);
}

function readStatusNumber(
  status: VehicleStatus | null | undefined,
  field: string,
): number | null {
  const value = status?.[field as keyof VehicleStatus];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeBoolLike(value: boolean | string | null | undefined): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (/^(true|on|open|active|locked|triggered|yes)$/i.test(value)) return true;
  if (/^(false|off|closed|inactive|disabled|unlocked|no)$/i.test(value)) return false;
  return null;
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!best || new Date(value).getTime() > new Date(best).getTime()) best = value;
  }
  return best;
}

function formatDateTimeShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'an unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
